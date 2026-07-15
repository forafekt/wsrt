// crates/runtime_rust/src/supervisor.rs

use crate::protocol::{
    ExitEvent, LogEvent, OutgoingMessage, SpawnParams, SpawnResult,
};
use anyhow::{Context, Result, anyhow};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::Arc,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{Mutex, mpsc},
};

type SharedChild = Arc<Mutex<Child>>;

#[derive(Clone)]
pub struct ProcessSupervisor {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
    outgoing: mpsc::UnboundedSender<OutgoingMessage>,
}

struct ManagedProcess {
    pid: u32,
    child: SharedChild,
}

impl ProcessSupervisor {
    pub fn new(
        outgoing: mpsc::UnboundedSender<OutgoingMessage>,
    ) -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            outgoing,
        }
    }

    pub async fn spawn(
        &self,
        spec: SpawnParams,
    ) -> Result<SpawnResult> {
        {
            let processes = self.processes.lock().await;

            if processes.contains_key(&spec.id) {
                return Err(anyhow!(
                    "process '{}' is already running",
                    spec.id
                ));
            }
        }

        let mut command = Command::new(&spec.command);

        command
            .args(&spec.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }

        command.envs(&spec.env);

        let mut child = command
            .spawn()
            .with_context(|| {
                format!(
                    "failed to spawn command '{}'",
                    spec.command
                )
            })?;

        let pid = child
            .id()
            .ok_or_else(|| anyhow!("spawned process has no PID"))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let child = Arc::new(Mutex::new(child));

        {
            let mut processes = self.processes.lock().await;

            processes.insert(
                spec.id.clone(),
                ManagedProcess {
                    pid,
                    child: child.clone(),
                },
            );
        }

        if let Some(stdout) = stdout {
            self.forward_output(
                spec.id.clone(),
                "stdout",
                stdout,
            );
        }

        if let Some(stderr) = stderr {
            self.forward_output(
                spec.id.clone(),
                "stderr",
                stderr,
            );
        }

        self.observe_exit(
            spec.id.clone(),
            pid,
            child,
        );

        Ok(SpawnResult {
            id: spec.id,
            pid,
        })
    }

    fn forward_output<R>(
        &self,
        process_id: String,
        stream: &'static str,
        output: R,
    )
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
    {
        let outgoing = self.outgoing.clone();

        tokio::spawn(async move {
            let mut lines = BufReader::new(output).lines();

            loop {
                match lines.next_line().await {
                    Ok(Some(message)) => {
                        let event = LogEvent {
                            id: process_id.clone(),
                            stream: stream.to_string(),
                            message,
                        };

                        match OutgoingMessage::event("log", event) {
                            Ok(message) => {
                                let _ = outgoing.send(message);
                            }
                            Err(error) => {
                                eprintln!(
                                    "failed to serialize log event: {error}"
                                );
                            }
                        }
                    }

                    Ok(None) => break,

                    Err(error) => {
                        eprintln!(
                            "failed reading {stream} for '{}': {error}",
                            process_id
                        );

                        break;
                    }
                }
            }
        });
    }

    fn observe_exit(
        &self,
        process_id: String,
        pid: u32,
        child: SharedChild,
    ) {
        let processes = self.processes.clone();
        let outgoing = self.outgoing.clone();

        tokio::spawn(async move {
            let status = {
                let mut child = child.lock().await;
                child.wait().await
            };

            processes.lock().await.remove(&process_id);

            let event = match status {
                Ok(status) => ExitEvent {
                    id: process_id,
                    pid,
                    code: status.code(),
                    signal: None,
                },

                Err(error) => {
                    eprintln!(
                        "failed waiting for process '{}': {error}",
                        process_id
                    );

                    ExitEvent {
                        id: process_id,
                        pid,
                        code: None,
                        signal: None,
                    }
                }
            };

            match OutgoingMessage::event("exit", event) {
                Ok(message) => {
                    let _ = outgoing.send(message);
                }
                Err(error) => {
                    eprintln!(
                        "failed to serialize exit event: {error}"
                    );
                }
            }
        });
    }

    pub async fn terminate(
        &self,
        id: &str,
    ) -> Result<bool> {
        let child = {
            let processes = self.processes.lock().await;

            processes
                .get(id)
                .map(|process| process.child.clone())
        };

        let Some(child) = child else {
            return Ok(false);
        };

        child
            .lock()
            .await
            .kill()
            .await
            .with_context(|| {
                format!("failed to terminate process '{id}'")
            })?;

        Ok(true)
    }

    pub async fn is_running(
        &self,
        id: &str,
    ) -> bool {
        self.processes.lock().await.contains_key(id)
    }

    pub async fn shutdown(&self) -> Result<()> {
        let children = {
            let processes = self.processes.lock().await;

            processes
                .values()
                .map(|process| process.child.clone())
                .collect::<Vec<_>>()
        };

        for child in children {
            let mut child = child.lock().await;

            if let Err(error) = child.kill().await {
                eprintln!("failed to stop child process: {error}");
            }
        }

        self.processes.lock().await.clear();

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn pid(
        &self,
        id: &str,
    ) -> Option<u32> {
        self.processes
            .lock()
            .await
            .get(id)
            .map(|process| process.pid)
    }
}