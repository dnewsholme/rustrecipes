// WebAuthn helpers for Passkey registration and authentication

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = window.btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const uint8Array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    uint8Array[i] = raw.charCodeAt(i);
  }
  return uint8Array.buffer;
}

export function decodeCreationOptions(options: any): any {
  if (typeof (PublicKeyCredential as any).parseCreationOptionsFromJSON === 'function') {
    return (PublicKeyCredential as any).parseCreationOptionsFromJSON(options);
  }
  const pk = { ...options };
  pk.challenge = base64urlToBuffer(pk.challenge);
  pk.user = {
    ...pk.user,
    id: typeof pk.user.id === 'string' ? base64urlToBuffer(pk.user.id) : pk.user.id,
  };
  if (pk.excludeCredentials) {
    pk.excludeCredentials = pk.excludeCredentials.map((cred: any) => ({
      ...cred,
      id: typeof cred.id === 'string' ? base64urlToBuffer(cred.id) : cred.id,
    }));
  }
  return pk;
}

export function decodeRequestOptions(options: any): any {
  if (typeof (PublicKeyCredential as any).parseRequestOptionsFromJSON === 'function') {
    return (PublicKeyCredential as any).parseRequestOptionsFromJSON(options);
  }
  const pk = { ...options };
  pk.challenge = base64urlToBuffer(pk.challenge);
  if (pk.allowCredentials) {
    pk.allowCredentials = pk.allowCredentials.map((cred: any) => ({
      ...cred,
      id: typeof cred.id === 'string' ? base64urlToBuffer(cred.id) : cred.id,
    }));
  }
  return pk;
}

export function serializeCredential(credential: any): any {
  if (typeof credential.toJSON === 'function') {
    return credential.toJSON();
  }
  const response = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
    },
  };
}

export function serializeAssertion(credential: any): any {
  if (typeof credential.toJSON === 'function') {
    return credential.toJSON();
  }
  const response = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  };
}
