/** Return the human-readable Nest validation/error message for an HTTP result. */
export function responseMessage(result) {
  const message = result?.json?.message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string') return message;
  return typeof result?.text === 'string' ? result.text : '';
}

export function isExpectedTwoFactorReauthRefusal(result) {
  return (
    result?.status === 401 &&
    /reauthentication is required before setting up 2fa/i.test(responseMessage(result))
  );
}

export function isExpectedAdminMfaRefusal(result) {
  return (
    result?.status === 403 &&
    /recent two-factor authentication is required for this admin action/i.test(
      responseMessage(result),
    )
  );
}

export function isExpectedPrivilegedRoleRefusal(result) {
  return (
    result?.status === 400 &&
    /role must be developer or advertiser|privileged roles cannot be self-assigned/i.test(
      responseMessage(result),
    )
  );
}

export function enabledMoneySwitches(settings) {
  return (Array.isArray(settings) ? settings : [])
    .filter((setting) => setting?.value?.enabled === true)
    .map((setting) => `${setting.scope}.${setting.target}`);
}
