export { CustomerAvatar } from './components/CustomerAvatar';
export { PhoneVerificationSheet } from './components/PhoneVerificationSheet';
export { useCustomerSession } from './hooks/useCustomerSession';
export { useCustomerProfile } from './hooks/useCustomerProfile';
export { useCustomerOrders } from './hooks/useCustomerOrders';
export { usePhoneVerification } from './hooks/usePhoneVerification';
export type {
  ActivePhoneCode,
  PhoneVerificationPhase,
  PhoneVerificationState,
} from './hooks/usePhoneVerification';
export { isProfileComplete, MEMBER_PROFILE_CHANGED, PHONE_VERIFIED_EVENT } from './profile';
export { AUTH_STR, PHONE_VERIFY_STR } from './strings';
export type {
  AccountOrder,
  AccountOrderItem,
  AccountStatus,
  CustomerProfile,
  CustomerUser,
} from './types';
