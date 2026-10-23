import React, { useState, useEffect } from 'react';
import { MenuData, MenuItem, CustomerDetails } from '../types/menu';
import { buildWhatsAppMessage, formatPrice } from '../utils/menuHelpers';
import { X, Plus, Minus, Trash2, Send, CheckCircle2, AlertCircle } from 'lucide-react';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  menu: MenuData;
  cartItems: { item: MenuItem; quantity: number }[];
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onRemoveItem: (itemId: string) => void;
  onClearCart: () => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  menu,
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  currency,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';
  const ordering = menu.settings.ordering;

  // Retrieve remembered customer details if available (delivery only)
  const [customer, setCustomer] = useState<CustomerDetails>(() => {
    try {
      const saved = localStorage.getItem('customer_details_v1');
      if (saved) return { ...JSON.parse(saved), orderType: 'delivery' };
    } catch {}
    return {
      name: '',
      phone: '',
      address: '',
      tableNumber: '',
      notes: '',
      orderType: 'delivery',
      remember: false,
    };
  });

  const [orderPrepared, setOrderPrepared] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      setOrderPrepared(false);
      setErrorMsg('');
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const subtotal = cartItems.reduce((acc, curr) => acc + curr.item.price * curr.quantity, 0);
  const deliveryFee = ordering.deliveryFee || 0;
  const grandTotal = subtotal + deliveryFee;
  const isBelowMin = ordering.minOrder > 0 && subtotal < ordering.minOrder;

  const handleSendOrder = () => {
    setErrorMsg('');

    // Validation
    if (!customer.name.trim()) {
      setErrorMsg(isAr ? 'يرجى إدخال اسمك الكريم' : 'Please enter your name');
      return;
    }
    if (!customer.phone.trim()) {
      setErrorMsg(isAr ? 'يرجى إدخال رقم هاتفك للتواصل' : 'Please enter your phone number');
      return;
    }
    if (!customer.address.trim()) {
      setErrorMsg(isAr ? 'يرجى إدخال عنوان التوصيل بالتفصيل' : 'Please enter delivery address');
      return;
    }
    if (isBelowMin) {
      setErrorMsg(
        isAr
          ? `الحد الأدنى للطلب هو ${formatPrice(ordering.minOrder, currency)}`
          : `Minimum order is ${formatPrice(ordering.minOrder, currency)}`
      );
      return;
    }

    // Save remember details
    try {
      if (customer.remember) {
        localStorage.setItem('customer_details_v1', JSON.stringify(customer));
      } else {
        localStorage.removeItem('customer_details_v1');
      }
    } catch {}

    const message = buildWhatsAppMessage(menu, cartItems, customer, lang);
    const whatsappNum = (menu.settings.whatsapp || '').replace(/[^0-9]/g, '');
    const url = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(message)}`;

    // Open WhatsApp
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.href = url;
    }

    setOrderPrepared(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 anim-fade-in"
        aria-hidden="true"
      />

      {/* Drawer on mobile, Centered Modal on Desktop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isAr ? 'سلة الطلبات وإتمام الشراء' : 'Order Checkout'}
        className={`relative z-10 w-full max-w-[540px] max-h-[92vh] overflow-y-auto overscroll-contain no-scrollbar rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[#FFC400] md:border-2 md:border-[#FFC400] px-6 sm:px-8 pt-4 sm:pt-6 pb-8 anim-drawer-in shadow-2xl transition-colors duration-200 ${
          darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'
        }`}
      >
        {/* Drag Pill Handle (Mobile only) */}
        <div
          className={`w-11 h-1.5 rounded-full mx-auto mb-4 md:hidden ${
            darkMode ? 'bg-neutral-600' : 'bg-neutral-300'
          }`}
        />

        {/* Header */}
        <div
          className={`flex justify-between items-center pb-3 border-b ${
            darkMode ? 'border-neutral-800' : 'border-neutral-200'
          }`}
        >
          <div>
            <h2 className={`text-xl font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {isAr ? 'سلة طلبك' : 'Your Order'}
            </h2>
            <p className={`text-xs mt-0.5 font-medium ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {cartItems.length} {isAr ? 'أصناف مختارة' : 'items selected'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              darkMode
                ? 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
                : 'bg-neutral-100 text-neutral-700 hover:text-black hover:bg-neutral-200'
            }`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Order Prepared Confirmation Screen */}
        {orderPrepared ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 text-green-600 flex items-center justify-center mx-auto">
              <CheckCircle2 size={36} />
            </div>
            <h3 className={`text-xl font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {isAr ? 'تم تجهيز طلبك بنجاح!' : 'Order prepared successfully!'}
            </h3>
            <p className={`text-sm max-w-xs mx-auto leading-relaxed ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
              {isAr
                ? 'يرجى الضغط على زر "إرسال" داخل تطبيق واتساب لتأكيد الطلب مع المطعم.'
                : 'Please press "Send" in WhatsApp to confirm your order with the kitchen.'}
            </p>
            <div className="pt-4 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleSendOrder}
                className="btn-tactile h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] font-bold text-sm flex items-center justify-center gap-2 shadow-md hover:bg-[#ffd033]"
              >
                <Send size={16} />
                <span>{isAr ? 'إعادة فتح واتساب' : 'Re-open WhatsApp'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearCart();
                  onClose();
                }}
                className={`h-11 rounded-full border text-xs font-semibold transition-colors ${
                  darkMode
                    ? 'border-neutral-700 text-neutral-300 hover:bg-white/5'
                    : 'border-neutral-300 text-neutral-700 hover:bg-black/5'
                }`}
              >
                {isAr ? 'مسح السلة وإغلاق' : 'Clear cart and close'}
              </button>
            </div>
          </div>
        ) : cartItems.length === 0 ? (
          <div className="py-12 text-center">
            <p className={`text-sm font-semibold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {isAr ? 'سلتك فارغة حالياً' : 'Your cart is empty'}
            </p>
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            {/* Cart Items List (no inner scroller: the list grows naturally) */}
            <div className="space-y-2.5">
              {cartItems.map(({ item, quantity }) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-colors ${
                    darkMode
                      ? 'bg-[#1c1c1c] border-neutral-800 text-white'
                      : 'bg-neutral-100 border-neutral-200 text-[#0A0A0A]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <h4 className={`font-bold text-sm truncate ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                      {isAr ? item.name.ar : item.name.en}
                    </h4>

                    {/* Highly Visible Price Pill & Unit Details */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full shadow-xs ${
                          darkMode
                            ? 'bg-[#FFC400] text-[#0A0A0A]'
                            : 'bg-[#0A0A0A] text-[#FFC400]'
                        }`}
                      >
                        {formatPrice(item.price * quantity, currency)}
                      </span>
                      <span className={`text-[11px] font-semibold ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
                        ({formatPrice(item.price, currency)}/pc)
                      </span>
                    </div>
                  </div>

                  {/* Quantity Stepper & Remove */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-[#FFC400] text-[#0A0A0A] rounded-full p-1 shadow-sm">
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.id, -1)}
                        className="w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors text-[#0A0A0A]"
                        aria-label="Decrease quantity"
                      >
                        <Minus size={12} className="stroke-[3]" />
                      </button>
                      <span className="font-black text-xs px-1 min-w-[18px] text-center text-[#0A0A0A]">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.id, 1)}
                        className="w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors text-[#0A0A0A]"
                        aria-label="Increase quantity"
                      >
                        <Plus size={12} className="stroke-[3]" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.id)}
                      className={`p-1.5 transition-colors ${
                        darkMode ? 'text-neutral-400 hover:text-red-400' : 'text-neutral-500 hover:text-red-600'
                      }`}
                      aria-label="Remove item"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Customer Inputs Form */}
            <div className="space-y-3">
              <div>
                <label className={`block text-xs font-bold mb-1 ${
                  darkMode ? 'text-neutral-200' : 'text-neutral-800'
                }`}>
                  {isAr ? 'الاسم *' : 'Your Name *'}
                </label>
                <input
                  type="text"
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                  placeholder={isAr ? 'مثال: أحمد محمد' : 'e.g. John Doe'}
                  maxLength={40}
                  className={`w-full h-11 px-3.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC400] transition-colors ${
                    darkMode
                      ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-500'
                      : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400 shadow-xs'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-xs font-bold mb-1 ${
                  darkMode ? 'text-neutral-200' : 'text-neutral-800'
                }`}>
                  {isAr ? 'رقم الهاتف *' : 'Phone Number *'}
                </label>
                <input
                  type="tel"
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                  placeholder={isAr ? 'مثال: 01012345678' : '+20 10 1234 5678'}
                  maxLength={20}
                  className={`w-full h-11 px-3.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC400] transition-colors ${
                    darkMode
                      ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-500'
                      : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400 shadow-xs'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-xs font-bold mb-1 ${
                  darkMode ? 'text-neutral-200' : 'text-neutral-800'
                }`}>
                  {isAr ? 'عنوان التوصيل بالتفصيل *' : 'Delivery Address *'}
                </label>
                <input
                  type="text"
                  value={customer.address}
                  onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
                  placeholder={isAr ? 'المنطقة، الشارع، رقم العمارة والشقة' : 'Area, street, bldg & apt number'}
                  maxLength={200}
                  className={`w-full h-11 px-3.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC400] transition-colors ${
                    darkMode
                      ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-500'
                      : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400 shadow-xs'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-xs font-bold mb-1 ${
                  darkMode ? 'text-neutral-200' : 'text-neutral-800'
                }`}>
                  {isAr ? 'ملاحظات إضافية (اختياري)' : 'Special Instructions (optional)'}
                </label>
                <input
                  type="text"
                  value={customer.notes}
                  onChange={(e) => setCustomer({ ...customer, notes: e.target.value })}
                  placeholder={isAr ? 'بدون بصل، صوص إضافي...' : 'No onions, extra sauce...'}
                  maxLength={200}
                  className={`w-full h-11 px-3.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC400] transition-colors ${
                    darkMode
                      ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-500'
                      : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400 shadow-xs'
                  }`}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  id="remember-details"
                  type="checkbox"
                  checked={customer.remember}
                  onChange={(e) => setCustomer({ ...customer, remember: e.target.checked })}
                  className="w-4 h-4 rounded text-[#FFC400] focus:ring-[#FFC400]"
                />
                <label
                  htmlFor="remember-details"
                  className={`text-xs select-none cursor-pointer font-bold ${
                    darkMode ? 'text-neutral-300' : 'text-neutral-700'
                  }`}
                >
                  {isAr ? 'تذكر بياناتي على هذا الجهاز' : 'Remember my details on this device'}
                </label>
              </div>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-xs font-bold">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Bill Summary */}
            <div
              className={`p-4 rounded-xl border space-y-2 text-xs transition-colors ${
                darkMode
                  ? 'bg-[#1c1c1c] border-neutral-800 text-neutral-300'
                  : 'bg-neutral-100 border-neutral-200 text-neutral-700'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className={darkMode ? 'text-neutral-400' : 'text-neutral-600'}>
                  {isAr ? 'المجموع الفرعي:' : 'Subtotal:'}
                </span>
                <span className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                  {formatPrice(subtotal, currency)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className={darkMode ? 'text-neutral-400' : 'text-neutral-600'}>
                  {isAr ? 'رسوم التوصيل:' : 'Delivery Fee:'}
                </span>
                <span className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                  {formatPrice(deliveryFee, currency)}
                </span>
              </div>

              {isBelowMin && (
                <div className="text-amber-600 font-bold text-[11px] pt-1">
                  * {isAr ? `الحد الأدنى للطلب ${formatPrice(ordering.minOrder, currency)}` : `Minimum order is ${formatPrice(ordering.minOrder, currency)}`}
                </div>
              )}

              <div
                className={`flex justify-between items-center text-sm font-black pt-2.5 border-t ${
                  darkMode ? 'border-neutral-700' : 'border-neutral-300'
                }`}
              >
                <span className={darkMode ? 'text-white' : 'text-[#0A0A0A]'}>
                  {isAr ? 'الإجمالي الكلي:' : 'Total:'}
                </span>
                <span className="text-base px-3.5 py-1 rounded-full bg-[#FFC400] text-[#0A0A0A] font-black shadow-xs">
                  {formatPrice(grandTotal, currency)}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={handleSendOrder}
                className="btn-tactile w-full h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] font-black text-sm flex items-center justify-center gap-2 shadow-lg hover:bg-[#ffd033]"
              >
                <Send size={18} />
                <span>{isAr ? 'إرسال الطلب عبر واتساب' : 'Send Order on WhatsApp'}</span>
              </button>

              <button
                type="button"
                onClick={onClearCart}
                className={`w-full h-10 rounded-full text-xs font-bold transition-colors ${
                  darkMode
                    ? 'text-neutral-400 hover:text-red-400'
                    : 'text-neutral-600 hover:text-red-600'
                }`}
              >
                {isAr ? 'إفراغ السلة' : 'Clear Cart'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
