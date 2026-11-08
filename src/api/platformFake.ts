import { ApiError } from './errors';
import { PLATFORM_CALL_NAMES, type PlatformApi } from './contract/platform';

/**
 * The prototype side of the platform calls (design 5.19). The interface is here so that the screens compile against it; plan D fills the
 * fake directory. Until then every call answers not_found, as the real route does for a person who is no platform owner.
 */
const refuse = (): Promise<never> => Promise.reject(new ApiError('not_found', 'The prototype platform is built by plan D.'));

export const fakePlatform: PlatformApi = Object.fromEntries(PLATFORM_CALL_NAMES.map((name) => [name, refuse])) as unknown as PlatformApi;
