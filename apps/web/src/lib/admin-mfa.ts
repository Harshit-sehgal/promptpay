export const ADMIN_MFA_RELOGIN_REQUIRED_KEY = 'ateva.adminMfaReloginRequired';

export function isAdministratorRole(role: string): boolean {
  return role === 'admin' || role === 'super_admin';
}
