import { notBuiltAsync } from '../core/notBuilt';
import type { AuthAdminPort } from '../core/ports';

/** AuthAdminPort over the GoTrue admin REST API with the secret key (plan 5.1). Track P replaces this stub. */
export function authAdminPort(_o: { supabaseUrl: string; secretKey: string }): AuthAdminPort {
  return {
    generateLink: () => notBuiltAsync('The Auth admin'),
    createUser: () => notBuiltAsync('The Auth admin'),
    setBanned: () => notBuiltAsync('The Auth admin'),
    updateEmail: () => notBuiltAsync('The Auth admin'),
  };
}
