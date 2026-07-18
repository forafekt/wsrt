mod protocol;
mod supervisor;

use anyhow::{Context, Result};
use protocol::{
    ConnectParams, EmptyResult, OutgoingMessage, PROTOCOL_VERSION, PingResult, Request,
    RequestBody, ShutdownResult, TerminateResult,
};
use supervisor::ProcessSupervisor;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    sync::mpsc,
};

#[tokio::main]
async fn main() -> Result<()> {
    let mut input = BufReader::new(tokio::io::stdin()).lines();
    let (outgoing_tx, mut outgoing_rx) = mpsc::channel::<OutgoingMessage>(1024);
    let writer = tokio::spawn(async move {
        let mut output = tokio::io::stdout();
        while let Some(message) = outgoing_rx.recv().await {
            let serialized = serde_json::to_vec(&message)?;
            output.write_all(&serialized).await?;
            output.write_all(b"\n").await?;
            output.flush().await?;
        }
        Ok::<(), anyhow::Error>(())
    });
    let supervisor = ProcessSupervisor::new(outgoing_tx.clone());
    while let Some(line) = input.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("malformed protocol request: {error}");
                continue;
            }
        };
        let id = request.id;
        let shutdown = matches!(request.body, RequestBody::Shutdown);
        let message = if request.protocol_version != PROTOCOL_VERSION {
            OutgoingMessage::error(id, "PROTOCOL_VERSION_UNSUPPORTED", request.protocol_version)
        } else {
            handle(id, request.body, &supervisor).await
        };
        if outgoing_tx.send(message).await.is_err() {
            break;
        }
        if shutdown {
            break;
        }
    }
    supervisor.shutdown().await?;
    drop(supervisor);
    drop(outgoing_tx);
    writer.await.context("protocol writer failed")??;
    Ok(())
}

async fn handle(id: String, body: RequestBody, supervisor: &ProcessSupervisor) -> OutgoingMessage {
    let result = match body {
        RequestBody::Ping => OutgoingMessage::response(
            id.clone(),
            PingResult {
                protocol_version: PROTOCOL_VERSION,
                version: env!("CARGO_PKG_VERSION"),
            },
        ),
        RequestBody::Spawn { params } => supervisor
            .spawn(params)
            .await
            .and_then(|value| OutgoingMessage::response(id.clone(), value)),
        RequestBody::Terminate { params } => supervisor
            .terminate(&params.id, params.signal.as_deref())
            .await
            .and_then(|accepted| {
                OutgoingMessage::response(id.clone(), TerminateResult { accepted })
            }),
        RequestBody::Connect { params } => connect(params)
            .await
            .and_then(|()| OutgoingMessage::response(id.clone(), EmptyResult {})),
        RequestBody::Shutdown => supervisor
            .shutdown()
            .await
            .and_then(|()| OutgoingMessage::response(id.clone(), ShutdownResult { stopped: true })),
    };
    result.unwrap_or_else(|error| OutgoingMessage::error(id, "OPERATION_FAILED", error))
}

async fn connect(params: ConnectParams) -> Result<()> {
    let address = format!("{}:{}", params.host, params.port);
    tokio::time::timeout(
        std::time::Duration::from_millis(params.timeout_ms),
        TcpStream::connect(&address),
    )
    .await
    .with_context(|| {
        format!(
            "TCP connection to {address} timed out after {}ms",
            params.timeout_ms
        )
    })??;
    Ok(())
}
