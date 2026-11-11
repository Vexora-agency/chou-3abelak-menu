export type LoginLang = 'en' | 'ar';

export type ErrorKey = 'required' | 'invalid' | 'locked' | 'network' | 'unavailable';

export const STR = {
  en: {
    back: 'Back to menu',
    console: 'Admin console',
    title: 'Welcome back',
    subtitle: 'Sign in to manage your menu, prices and ordering settings.',
    username: 'Email or username',
    password: 'Password',
    remember: 'Keep me signed in',
    forgot: 'Forgot password?',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    welcome: 'Welcome back',
    opening: 'Opening your dashboard…',
    secure: 'Protected area. Authorized staff only.',
    caps: 'Caps Lock is on',
    show: 'Show password',
    hide: 'Hide password',
    required: 'Please enter your email and password.',
    invalid: 'Incorrect email or password. Please try again.',
    locked: 'Too many attempts. Try again in {n} min.',
    network: 'Connection problem. Check your internet and try again.',
    unavailable: 'Login is not available right now (server not configured). Try again later.',
    switchTo: 'Switch to English',
  },
  ar: {
    back: 'العودة إلى القائمة',
    console: 'لوحة التحكم',
    title: 'أهلاً بعودتك',
    subtitle: 'سجّل الدخول لإدارة القائمة والأسعار وإعدادات الطلب.',
    username: 'البريد الإلكتروني أو اسم المستخدم',
    password: 'كلمة المرور',
    remember: 'ابقني مسجّلًا',
    forgot: 'نسيت كلمة المرور؟',
    signIn: 'تسجيل الدخول',
    signingIn: 'جارٍ تسجيل الدخول…',
    welcome: 'أهلاً بعودتك',
    opening: 'جارٍ فتح لوحة التحكم…',
    secure: 'منطقة محمية. للموظفين المصرّح لهم فقط.',
    caps: 'زر Caps Lock مفعّل',
    show: 'إظهار كلمة المرور',
    hide: 'إخفاء كلمة المرور',
    required: 'يرجى إدخال البريد وكلمة المرور.',
    invalid: 'البريد أو كلمة المرور غير صحيحة. حاول مرة أخرى.',
    locked: 'محاولات كثيرة. حاول بعد {n} دقيقة.',
    network: 'مشكلة في الاتصال. تحقق من الإنترنت وحاول مجددًا.',
    unavailable: 'تسجيل الدخول غير متاح حاليًا (الخادم غير مجهّز). حاول لاحقًا.',
    switchTo: 'التبديل إلى العربية',
  },
} as const;

// Widened from the STR literal union on purpose: sibling screens (invite)
// reuse the same components with their own copy. Lookups still typecheck;
// behavior is unchanged (types only, no runtime effect).
export type LoginStrings = Record<string, string>;
