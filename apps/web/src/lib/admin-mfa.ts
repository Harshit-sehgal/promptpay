export const ADMIN_MFA_RELOGIN_REQUIRED_KEY = 'waitlayer.adminMfaReloginRequired';

export function isAdministratorRole(role: string): boolean {
  return role === 'admin' || role === 'super_admin';
}
