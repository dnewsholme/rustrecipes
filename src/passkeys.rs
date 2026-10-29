use crate::{AppState, models::UserPasskey, storage};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use axum_extra::extract::cookie::{Cookie, PrivateCookieJar, SameSite};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use webauthn_rs::prelude::*;

#[derive(Deserialize)]
pub struct RegisterStartRequest {
    #[allow(dead_code)]
    #[serde(alias = "name")]
    pub key_name: Option<String>,
}

pub async fn passkeys_register_start(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Json(_req): Json<RegisterStartRequest>,
) -> impl IntoResponse {
    let user_id = match crate::get_session_user_id(&jar).await {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response(),
    };

    let user = match storage::find_user_by_id(&user_id) {
        Some(u) => u,
        None => return (StatusCode::UNAUTHORIZED, "User not found").into_response(),
    };

    let user_uuid = match Uuid::parse_str(&user.id) {
        Ok(u) => u,
        Err(_) => {
            // Generate a namespace UUID if it's not a standard UUID (like fallback admin ID)
            Uuid::new_v5(&Uuid::NAMESPACE_DNS, user.id.as_bytes())
        }
    };

    // Exclude existing credentials
    let existing_passkeys = storage::find_passkeys_by_user_id(&user_id);
    let exclude_credentials = if existing_passkeys.is_empty() {
        None
    } else {
        let creds = existing_passkeys
            .iter()
            .filter_map(|pk| {
                let p: Passkey = serde_json::from_str(&pk.passkey_json).ok()?;
                Some(p.cred_id().clone())
            })
            .collect::<Vec<_>>();
        Some(creds)
    };

    match state.webauthn.start_passkey_registration(
        user_uuid,
        &user.email,
        &user.email,
        exclude_credentials,
    ) {
        Ok((challenge, registration)) => {
            let reg_id = Uuid::new_v4().to_string();
            {
                let mut map = state.reg_states.lock().unwrap();
                map.insert(reg_id.clone(), registration);
            }

            #[derive(Serialize)]
            struct RegisterStartResponse {
                reg_id: String,
                challenge: CreationChallengeResponse,
                #[serde(rename = "publicKey")]
                public_key: serde_json::Value,
            }
            let public_key =
                serde_json::to_value(&challenge.public_key).unwrap_or(serde_json::Value::Null);
            tracing::info!("Passkey registration started for user_id='{}'", user_id);
            (
                StatusCode::OK,
                Json(RegisterStartResponse {
                    reg_id,
                    challenge,
                    public_key,
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("Failed to start passkey registration: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to start registration",
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct RegisterFinishRequest {
    pub reg_id: String,
    #[serde(alias = "name")]
    pub key_name: Option<String>,
    #[serde(alias = "response")]
    pub credential: RegisterPublicKeyCredential,
}

pub async fn passkeys_register_finish(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Json(req): Json<RegisterFinishRequest>,
) -> impl IntoResponse {
    let user_id = match crate::get_session_user_id(&jar).await {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response(),
    };

    let registration = {
        let mut map = state.reg_states.lock().unwrap();
        match map.remove(&req.reg_id) {
            Some(r) => r,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    "Registration session expired or invalid",
                )
                    .into_response();
            }
        }
    };

    match state
        .webauthn
        .finish_passkey_registration(&req.credential, &registration)
    {
        Ok(passkey) => {
            let passkey_json = serde_json::to_string(&passkey).unwrap();
            use base64::Engine;
            let cred_id_str =
                base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(passkey.cred_id());

            let key_name_final = req
                .key_name
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "Passkey".to_string());

            let user_passkey = UserPasskey {
                id: cred_id_str,
                user_id: user_id.clone(),
                name: key_name_final,
                passkey_json,
                created_at: "".to_string(),
            };

            if let Err(e) = storage::save_passkey(&user_passkey) {
                tracing::error!("Failed to save passkey: {:?}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save passkey")
                    .into_response();
            }

            tracing::info!("Passkey registered successfully for user_id='{}'", user_id);
            (StatusCode::OK, "Passkey registered successfully").into_response()
        }
        Err(e) => {
            tracing::error!("Failed to finish passkey registration: {:?}", e);
            (
                StatusCode::BAD_REQUEST,
                "Failed to verify passkey credential",
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct LoginStartRequest {
    pub email: String,
}

pub async fn passkeys_login_start(
    State(state): State<AppState>,
    Json(req): Json<LoginStartRequest>,
) -> impl IntoResponse {
    let admin_email = std::env::var("ADMIN_EMAIL").unwrap_or_default();
    let email_lookup = if req.email.trim().to_lowercase() == "admin" && !admin_email.is_empty() {
        admin_email
    } else {
        req.email.trim().to_string()
    };

    let user = match storage::find_user_by_email(&email_lookup) {
        Some(u) => u,
        None => return (StatusCode::NOT_FOUND, "User not found").into_response(),
    };

    let existing_passkeys = storage::find_passkeys_by_user_id(&user.id);
    if existing_passkeys.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "No passkeys registered for this user",
        )
            .into_response();
    }

    let credentials = existing_passkeys
        .iter()
        .filter_map(|pk| {
            let p: Passkey = serde_json::from_str(&pk.passkey_json).ok()?;
            Some(p)
        })
        .collect::<Vec<_>>();

    match state.webauthn.start_passkey_authentication(&credentials) {
        Ok((challenge, authentication)) => {
            let auth_id = Uuid::new_v4().to_string();
            {
                let mut map = state.auth_states.lock().unwrap();
                map.insert(auth_id.clone(), authentication);
            }

            #[derive(Serialize)]
            struct LoginStartResponse {
                auth_id: String,
                challenge: RequestChallengeResponse,
                #[serde(rename = "publicKey")]
                public_key: serde_json::Value,
            }
            let public_key =
                serde_json::to_value(&challenge.public_key).unwrap_or(serde_json::Value::Null);
            tracing::info!("Passkey login started for email='{}'", email_lookup);
            (
                StatusCode::OK,
                Json(LoginStartResponse {
                    auth_id,
                    challenge,
                    public_key,
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("Failed to start passkey authentication: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to start authentication",
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct LoginFinishRequest {
    pub auth_id: String,
    pub email: String,
    #[serde(alias = "response")]
    pub credential: PublicKeyCredential,
}

pub async fn passkeys_login_finish(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Json(req): Json<LoginFinishRequest>,
) -> impl IntoResponse {
    let admin_email = std::env::var("ADMIN_EMAIL").unwrap_or_default();
    let email_lookup = if req.email.trim().to_lowercase() == "admin" && !admin_email.is_empty() {
        admin_email
    } else {
        req.email.trim().to_string()
    };

    let user = match storage::find_user_by_email(&email_lookup) {
        Some(u) => u,
        None => return (StatusCode::NOT_FOUND, "User not found").into_response(),
    };

    let authentication = {
        let mut map = state.auth_states.lock().unwrap();
        match map.remove(&req.auth_id) {
            Some(a) => a,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    "Authentication session expired or invalid",
                )
                    .into_response();
            }
        }
    };

    match state
        .webauthn
        .finish_passkey_authentication(&req.credential, &authentication)
    {
        Ok(_auth_result) => {
            let cookie_path = if state.app_base.is_empty() {
                "/"
            } else {
                state.app_base
            };
            let cookie = Cookie::build(("admin_session", user.id.clone()))
                .path(cookie_path)
                .http_only(true)
                .secure(crate::is_cookie_secure())
                .same_site(SameSite::Lax)
                .max_age(time::Duration::days(30))
                .build();
            let jar = jar.add(cookie);

            tracing::info!("Passkey login successful for user: {}", user.email);

            #[derive(Serialize)]
            struct LoginFinishResponse {
                status: String,
            }
            (
                StatusCode::OK,
                jar,
                Json(LoginFinishResponse {
                    status: "success".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("Failed to finish passkey authentication: {:?}", e);
            (
                StatusCode::BAD_REQUEST,
                "Failed to verify passkey signature",
            )
                .into_response()
        }
    }
}

pub async fn passkeys_list(jar: PrivateCookieJar) -> impl IntoResponse {
    let user_id = match crate::get_session_user_id(&jar).await {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response(),
    };

    let passkeys = storage::find_passkeys_by_user_id(&user_id);

    #[derive(Serialize)]
    pub struct PasskeyResponse {
        pub id: String,
        pub name: String,
        pub created_at: String,
    }

    let resp = passkeys
        .into_iter()
        .map(|pk| PasskeyResponse {
            id: pk.id,
            name: pk.name,
            created_at: pk.created_at,
        })
        .collect::<Vec<_>>();

    tracing::info!(
        "Listing passkeys for user_id='{}', found={}",
        user_id,
        resp.len()
    );
    (StatusCode::OK, Json(resp)).into_response()
}

pub async fn passkeys_delete(jar: PrivateCookieJar, Path(id): Path<String>) -> impl IntoResponse {
    let user_id = match crate::get_session_user_id(&jar).await {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response(),
    };

    match storage::delete_passkey_by_id(&id, &user_id) {
        Ok(_) => {
            tracing::info!("Passkey deleted: id='{}' for user_id='{}'", id, user_id);
            (StatusCode::OK, "Passkey deleted").into_response()
        }
        Err(e) => {
            tracing::error!("Failed to delete passkey: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete passkey",
            )
                .into_response()
        }
    }
}
