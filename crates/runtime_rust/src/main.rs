// crates/runtime_rust/src/main.rs

mod protocol;
mod supervisor;

use crate::{
    protocol::{
        OutgoingMessage, PingResult, Request, RequestBody,
        RunningResult, ShutdownResult, TerminateResult,
    },
    supervisor::ProcessSupervisor,
};
use anyhow::{Context, Result};
use tokio::{
    io::{
        AsyncBufReadExt, AsyncWriteExt, BufReader,
    },
    sync::mpsc,
};

#[tokio::main]
async fn main() -> Result<()> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let mut input = BufReader::new(stdin).lines();
    let mut output = stdout;

    let (outgoing_tx, mut outgoing_rx) =
        mpsc::unbounded_channel::<OutgoingMessage>();

    let supervisor =
        ProcessSupervisor::new(outgoing_tx.clone());

    let writer = tokio::spawn(async move {
        while let Some(message) = outgoing_rx.recv().await {
            let serialized = serde_json::to_string(&message)
                .context("failed to serialize outgoing message")?;

            output
                .write_all(serialized.as_bytes())
                .await
                .context("failed to write protocol message")?;

            output
                .write_all(b"\n")
                .await
                .context("failed to write protocol newline")?;

            output
                .flush()
                .await
                .context("failed to flush protocol output")?;
        }

        Ok::<(), anyhow::Error>(())
    });

    let mut should_shutdown = false;

    while !should_shutdown {
        let Some(line) = input.next_line().await? else {
            break;
        };

        if line.trim().is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,

            Err(error) => {
                eprintln!("invalid runtime request: {error}");
                continue;
            }
        };

        let request_id = request.id;

        let response = match request.body {
            RequestBody::Ping => {
                OutgoingMessage::response(
                    request_id.clone(),
                    PingResult {
                        version: env!(
                            "CARGO_PKG_VERSION"
                        )
                        .to_string(),
                    },
                )
            }

            RequestBody::Spawn { params } => {
                match supervisor.spawn(params).await {
                    Ok(result) => {
                        OutgoingMessage::response(
                            request_id.clone(),
                            result,
                        )
                    }

                    Err(error) => Ok(
                        OutgoingMessage::error(
                            request_id.clone(),
                            "SPAWN_FAILED",
                            error.to_string(),
                        ),
                    ),
                }
            }

            RequestBody::Terminate { params } => {
                match supervisor
                    .terminate(&params.id)
                    .await
                {
                    Ok(terminated) => {
                        OutgoingMessage::response(
                            request_id.clone(),
                            TerminateResult {
                                terminated,
                            },
                        )
                    }

                    Err(error) => Ok(
                        OutgoingMessage::error(
                            request_id.clone(),
                            "TERMINATE_FAILED",
                            error.to_string(),
                        ),
                    ),
                }
            }

            RequestBody::IsRunning { params } => {
                OutgoingMessage::response(
                    request_id.clone(),
                    RunningResult {
                        running: supervisor
                            .is_running(&params.id)
                            .await,
                    },
                )
            }

            RequestBody::Shutdown => {
                should_shutdown = true;

                match supervisor.shutdown().await {
                    Ok(()) => {
                        OutgoingMessage::response(
                            request_id.clone(),
                            ShutdownResult {
                                stopped: true,
                            },
                        )
                    }

                    Err(error) => Ok(
                        OutgoingMessage::error(
                            request_id.clone(),
                            "SHUTDOWN_FAILED",
                            error.to_string(),
                        ),
                    ),
                }
            }
        };

        match response {
            Ok(response) => {
                let _ = outgoing_tx.send(response);
            }

            Err(error) => {
                let _ = outgoing_tx.send(
                    OutgoingMessage::error(
                        request_id,
                        "INTERNAL_ERROR",
                        error.to_string(),
                    ),
                );
            }
        }
    }

    supervisor.shutdown().await?;

    drop(outgoing_tx);

    writer
        .await
        .context("runtime writer task failed")??;

    Ok(())
}