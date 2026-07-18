use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum RequestBody {
    Ping,
    Spawn { params: SpawnParams },
    Terminate { params: TerminateParams },
    Connect { params: ConnectParams },
    Shutdown,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub protocol_version: u32,
    pub id: String,
    #[serde(flatten)]
    pub body: RequestBody,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnParams {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub environment: HashMap<String, String>,
    #[serde(default)]
    pub shell: bool,
}

#[derive(Debug, Deserialize)]
pub struct TerminateParams {
    pub id: String,
    pub signal: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum OutgoingMessage {
    Response {
        id: String,
        result: serde_json::Value,
    },
    Error {
        id: String,
        error: ProtocolError,
    },
    Event {
        event: String,
        payload: serde_json::Value,
    },
}

#[derive(Debug, Serialize)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
}

impl OutgoingMessage {
    pub fn response<T: Serialize>(id: String, result: T) -> anyhow::Result<Self> {
        Ok(Self::Response {
            id,
            result: serde_json::to_value(result)?,
        })
    }
    pub fn error(id: String, code: &str, message: impl ToString) -> Self {
        Self::Error {
            id,
            error: ProtocolError {
                code: code.into(),
                message: message.to_string(),
            },
        }
    }
    pub fn event<T: Serialize>(event: &str, payload: T) -> anyhow::Result<Self> {
        Ok(Self::Event {
            event: event.into(),
            payload: serde_json::to_value(payload)?,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub protocol_version: u32,
    pub version: &'static str,
}
#[derive(Debug, Serialize)]
pub struct SpawnResult {
    pub pid: u32,
}
#[derive(Debug, Serialize)]
pub struct TerminateResult {
    pub accepted: bool,
}
#[derive(Debug, Serialize)]
pub struct ShutdownResult {
    pub stopped: bool,
}
#[derive(Debug, Serialize)]
pub struct EmptyResult {}
#[derive(Debug, Serialize)]
pub struct OutputEvent {
    pub id: String,
    pub stream: &'static str,
    pub data: String,
}
#[derive(Debug, Serialize)]
pub struct ExitEvent {
    pub id: String,
    pub pid: u32,
    pub code: Option<i32>,
    pub signal: Option<String>,
}
