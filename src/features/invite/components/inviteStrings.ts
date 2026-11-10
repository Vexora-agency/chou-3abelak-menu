import type { LoginLang, LoginStrings } from '@/src/features/admin/components/admin-login/loginStrings';

/**
 * Invite copy in the exact LoginStrings shape (plus invite-only extras), so
 * the page reuses the login screen's own components and motion language and
 * the two screens stay pixel-identical. Extra keys are fine — the shared
 * components only read the keys they know.
 */
export type InviteStrings = LoginStrings & {
  confirm: string;
  forAccount: string;
  policy12: string;
  policyMatch: string;
  kitchenTitle: string;
  kitchenSubtitle: string;
  enterAs: string;
  enterKitchen: string;
  enteringKitchen: string;
};

export const ISTR: Record<LoginLang, InviteStrings> = {
  en: {
    back: 'Back to menu',
    console: 'Private invite',
    title: 'Set your password',
    subtitle: 'Create the password for this login. The link dies the moment you use it.',
    username: 'Login name',
    password: 'New password',
    confirm: 'Confirm new password',
    forAccount: 'For login',
    remember: 'Keep me signed in',
    forgot: 'Forgot password?',
    signIn: 'Create my login',
    signingIn: 'Creating your login…',
    welcome: "You're in",
    opening: 'Opening your dashboard…',
    secure: 'Single-use invite. Never share this link.',
    caps: 'Caps Lock is on',
    show: 'Show password',
    hide: 'Hide password',
    required: 'Please fill both password fields.',
    invalid: 'This link is invalid or expired. Ask the store for a new one.',
    locked: 'Too many attempts. Try again in {n} min.',
    network: 'Connection problem. Check your internet and try again.',
    unavailable: 'This service is not available right now. Try again later.',
    switchTo: 'Switch to English',
    policy12: 'At least 12 characters',
    policyMatch: 'Passwords match',
    kitchenTitle: 'Kitchen access',
    kitchenSubtitle: 'Tap once to enter — no password. This link dies after first use.',
    enterAs: 'Enter as',
    enterKitchen: 'Enter the kitchen',
    enteringKitchen: 'Entering…',
  },
  ar: {
    back: 'عودة للمنيو',
    console: 'دعوة خاصة',
    title: 'ضع كلمة السر',
    subtitle: 'أنشئ كلمة السر لهذا الدخول. الرابط يموت لحظة استخدامه.',
    username: 'اسم الدخول',
    password: 'كلمة السر الجديدة',
    confirm: 'تأكيد كلمة السر',
    forAccount: 'لهذا الحساب',
    policy12: '12 حرفًا على الأقل',
    policyMatch: 'التطابق',
    kitchenTitle: 'دخول المطبخ',
    kitchenSubtitle: 'اضغط مرة واحدة للدخول — بلا كلمة سر. الرابط يموت بعد أول استخدام.',
    enterAs: 'الدخول كـ',
    enterKitchen: 'ادخل إلى المطبخ',
    enteringKitchen: 'جارٍ الدخول…',
    remember: 'تذكرني',
    forgot: 'نسيت كلمة السر؟',
    signIn: 'إنشاء الدخول',
    signingIn: 'جارٍ إنشاء الدخول…',
    welcome: 'أهلاً بك',
    opening: 'جارٍ فتح لوحتك…',
    secure: 'دعوة لمرة واحدة. لا تشارك الرابط أبدًا.',
    caps: 'زر الحروف الكبيرة مفعّل',
    show: 'إظهار كلمة السر',
    hide: 'إخفاء كلمة السر',
    required: 'املأ حقلَي كلمة السر.',
    invalid: 'هذا الرابط غير صالح أو انتهى. اطلب رابطًا جديدًا من المتجر.',
    locked: 'محاولات كثيرة. حاول بعد {n} دقيقة.',
    network: 'تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.',
    unavailable: 'الخدمة غير متاحة الآن. حاول لاحقًا.',
    switchTo: 'Switch to English',
  },
};
