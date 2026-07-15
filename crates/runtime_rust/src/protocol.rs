// crates/runtime_rust/src/protocol.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum RequestBody {
    Ping,

    Spawn {
        params: SpawnParams,
    },

    Terminate {
        params: TerminateParams,
    },

    IsRunning {
        params: ProcessReference,
    },

    Shutdown,
}

#[derive(Debug, Deserialize)]
pub struct Request {
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

    pub cwd: Option<String>,

    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminateParams {
    pub id: String,
    // pub signal: Option<String>,
    // pub timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct ProcessReference {
    pub id: String,
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
    pub fn response<T>(id: impl Into<String>, result: T) -> anyhow::Result<Self>
    where
        T: Serialize,
    {
        Ok(Self::Response {
            id: id.into(),
            result: serde_json::to_value(result)?,
        })
    }

    pub fn error(
        id: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self::Error {
            id: id.into(),
            error: ProtocolError {
                code: code.into(),
                message: message.into(),
            },
        }
    }

    pub fn event<T>(event: impl Into<String>, payload: T) -> anyhow::Result<Self>
    where
        T: Serialize,
    {
        Ok(Self::Event {
            event: event.into(),
            payload: serde_json::to_value(payload)?,
        })
    }
}

#[derive(Debug, Serialize)]
pub struct PingResult {
    pub version: String,
}

#[derive(Debug, Serialize)]
pub struct SpawnResult {
    pub id: String,
    pub pid: u32,
}

#[derive(Debug, Serialize)]
pub struct TerminateResult {
    pub terminated: bool,
}

#[derive(Debug, Serialize)]
pub struct RunningResult {
    pub running: bool,
}

#[derive(Debug, Serialize)]
pub struct ShutdownResult {
    pub stopped: bool,
}

#[derive(Debug, Serialize)]
pub struct LogEvent {
    pub id: String,
    pub stream: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct ExitEvent {
    pub id: String,
    pub pid: u32,
    pub code: Option<i32>,
    pub signal: Option<String>,
}