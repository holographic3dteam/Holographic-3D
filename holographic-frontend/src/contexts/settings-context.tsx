// contexts/settings-context.tsx
// Provides theme (dark | light) and language (en | ar) app-wide.
// Persists in localStorage; applies data-theme + dir to <html> on change.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme    = "dark" | "light";
export type Language = "en" | "ar";

interface SettingsCtx {
  theme:       Theme;
  language:    Language;
  setTheme:    (t: Theme)    => void;
  setLanguage: (l: Language) => void;
}

const Ctx = createContext<SettingsCtx>({
  theme: "dark", setTheme: () => {},
  language: "en", setLanguage: () => {},
});

export const useSettings = () => useContext(Ctx);

// ── Apply helpers ─────────────────────────────────────────────────────────────
function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}
function applyLang(l: Language) {
  document.documentElement.lang = l;
  document.documentElement.dir  = l === "ar" ? "rtl" : "ltr";
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem("holo3d_theme") as Theme) ?? "dark"
  );
  const [language, setLangState] = useState<Language>(
    () => (localStorage.getItem("holo3d_lang") as Language) ?? "en"
  );

  // Apply on first render
  useEffect(() => {
    applyTheme(theme);
    applyLang(language);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("holo3d_theme", t);
    applyTheme(t);
  };
  const setLanguage = (l: Language) => {
    setLangState(l);
    localStorage.setItem("holo3d_lang", l);
    applyLang(l);
  };

  return (
    <Ctx.Provider value={{ theme, language, setTheme, setLanguage }}>
      {children}
    </Ctx.Provider>
  );
}

// ── i18n — full app translations ─────────────────────────────────────────────
const _i18n: Record<string, Record<Language, string>> = {
  // ── Sidebar / Settings ──
  generate:   { en: "Generate",    ar: "توليد"        },
  history:    { en: "History",     ar: "السجل"        },
  saved:      { en: "Saved",       ar: "المحفوظات"    },
  upload:     { en: "Upload",      ar: "رفع"          },
  request:    { en: "Request",     ar: "طلب"          },
  settings:   { en: "Settings",    ar: "الإعدادات"    },
  signout:    { en: "Sign out",    ar: "تسجيل الخروج" },
  appearance: { en: "Appearance",  ar: "المظهر"       },
  dark:       { en: "Dark",        ar: "داكن"         },
  light:      { en: "Light",       ar: "فاتح"         },
  language:   { en: "Language",    ar: "اللغة"        },
  online:     { en: "Online",      ar: "متصل"         },

  // ── Home page ──
  home_studio:          { en: "AI Design Studio",       ar: "استوديو التصميم بالذكاء الاصطناعي" },
  home_configure:       { en: "Configure your vision.",  ar: "صمّم رؤيتك." },
  home_craft:           { en: "We'll craft the reality.", ar: "ونحن نحوّلها لواقع." },
  home_select_attrs:    { en: "Select attributes. Our AI generates a precise blueprint and matches it to the closest factory product.",
                          ar: "اختر الخصائص. الذكاء الاصطناعي يولّد تصميمًا دقيقًا ويطابقه بأقرب منتج من المصنع." },
  home_step_configure:  { en: "Configure",      ar: "الإعداد"       },
  home_step_prompt:     { en: "Prompt",          ar: "الوصف"         },
  home_step_results:    { en: "Results",         ar: "النتائج"       },
  home_reset:           { en: "Reset",           ar: "إعادة تعيين"   },
  home_start_over:      { en: "Start over",      ar: "بداية جديدة"   },
  home_object_class:    { en: "Object Class",    ar: "نوع الأثاث"    },

  // Category labels
  cat_chair:            { en: "Chair",           ar: "كرسي"          },
  cat_sofa:             { en: "Sofa",            ar: "أريكة"         },
  cat_table:            { en: "Table",           ar: "طاولة"         },

  // Chair types
  type_chair:           { en: "Chair Type",      ar: "نوع الكرسي"    },
  type_armchair:        { en: "Armchair",         ar: "كرسي بذراعين"  },
  type_office_chair:    { en: "Office Chair",     ar: "كرسي مكتب"     },
  type_lounge_chair:    { en: "Lounge Chair",     ar: "كرسي استرخاء"  },
  type_gaming_chair:    { en: "Gaming Chair",     ar: "كرسي ألعاب"    },

  // Sofa types
  type_sofa:            { en: "Sofa Type",        ar: "نوع الأريكة"   },
  type_sectional_sofa:  { en: "Sectional Sofa",   ar: "أريكة زاوية"   },
  type_loveseat:        { en: "Loveseat",          ar: "مقعد حب"       },
  type_ottoman_sofa:    { en: "Ottoman Sofa",      ar: "أريكة عثمانية" },

  // Table types
  type_table:           { en: "Table Type",       ar: "نوع الطاولة"   },
  type_coffee_table:    { en: "Coffee Table",      ar: "طاولة قهوة"    },
  type_dining_table:    { en: "Dining Table",      ar: "طاولة طعام"    },
  type_end_table:       { en: "End Table",         ar: "طاولة جانبية"  },
  type_side_table:      { en: "Side Table",        ar: "طاولة جانبية"  },

  // Colors
  label_color:          { en: "Color",            ar: "اللون"         },
  color_white:          { en: "White",            ar: "أبيض"          },
  color_beige:          { en: "Beige",            ar: "بيج"           },
  color_gray:           { en: "Gray",             ar: "رمادي"         },
  color_brown:          { en: "Brown",            ar: "بني"           },
  color_black:          { en: "Black",            ar: "أسود"          },
  color_blue:           { en: "Blue",             ar: "أزرق"          },
  color_green:          { en: "Green",            ar: "أخضر"          },
  color_red:            { en: "Red",              ar: "أحمر"          },
  color_orange:         { en: "Orange",           ar: "برتقالي"       },
  color_pink:           { en: "Pink",             ar: "وردي"          },
  color_tan:            { en: "Tan",              ar: "سمرة"          },

  // Materials
  label_material:       { en: "Material",         ar: "الخامة"        },
  mat_fabric:           { en: "Fabric",           ar: "قماش"          },
  mat_leather:          { en: "Leather",          ar: "جلد"           },
  mat_mesh:             { en: "Mesh",             ar: "شبك"           },
  mat_linen:            { en: "Linen",            ar: "كتان"          },
  mat_microfiber:       { en: "Microfiber",       ar: "مايكروفايبر"   },
  mat_velvet:           { en: "Velvet",           ar: "مخمل"          },
  mat_metal:            { en: "Metal",            ar: "معدن"          },
  mat_wooden:           { en: "Wooden",           ar: "خشب"           },
  mat_marble:           { en: "Marble",           ar: "رخام"          },
  mat_glass:            { en: "Glass",            ar: "زجاج"          },

  // Back Style
  label_back_style:     { en: "Back Style",       ar: "ظهر الكرسي"    },
  back_low:             { en: "Low Back",          ar: "ظهر منخفض"     },
  back_high:            { en: "High Back",         ar: "ظهر عالي"      },
  back_padded:          { en: "Padded Back",       ar: "ظهر مبطن"      },
  back_upholstered:     { en: "Upholstered Back",  ar: "ظهر منجد"      },
  back_curved:          { en: "Curved Back",       ar: "ظهر منحني"     },
  back_plain:           { en: "Plain Back",        ar: "ظهر عادي"      },
  back_soft:            { en: "Soft Back",         ar: "ظهر ناعم"      },
  back_straight:        { en: "Straight Back",     ar: "ظهر مستقيم"    },
  back_plush:           { en: "Plush Back",        ar: "ظهر قطيفة"     },
  back_rounded:         { en: "Rounded Back",      ar: "ظهر دائري"     },

  // Features
  label_features:       { en: "Features",         ar: "المميزات"      },
  feat_armrests:        { en: "With Armrests",     ar: "مساند ذراع"    },
  feat_wheels:          { en: "With Wheels",       ar: "عجلات"         },
  feat_no_wheels:       { en: "Without Wheels",    ar: "بدون عجلات"    },
  feat_recliner:        { en: "Recliner",          ar: "إمالة"         },

  // Table shape
  label_shape:          { en: "Shape",            ar: "الشكل"         },
  shape_rectangle:      { en: "Rectangle",        ar: "مستطيل"        },
  shape_square:         { en: "Square",           ar: "مربع"          },
  shape_round:          { en: "Round",            ar: "دائري"         },
  shape_oval:           { en: "Oval",             ar: "بيضاوي"        },

  // Table legs
  label_legs:           { en: "Legs",             ar: "الأرجل"        },
  legs_metal:           { en: "Metal Legs",       ar: "أرجل معدنية"   },
  legs_wood:            { en: "Wood Legs",        ar: "أرجل خشبية"    },

  // Generate actions
  home_surprise:        { en: "Surprise Me",      ar: "فاجئني"        },
  home_generate_design: { en: "Generate Design  ›", ar: "توليد التصميم  ›" },
  home_synthesizing:    { en: "Synthesizing...",   ar: "جاري التوليد..."  },
  home_connecting:      { en: "Connecting to AI...", ar: "جاري الاتصال بالذكاء الاصطناعي..." },
  home_loading_models:  { en: "Loading models...", ar: "جاري تحميل النماذج..." },
  home_variation:       { en: "Variation",         ar: "نسخة مختلفة"   },
  home_stop:            { en: "Stop",              ar: "إيقاف"         },
  home_stopping:        { en: "Stopping...",       ar: "جاري الإيقاف..." },
  home_or_press:        { en: "or press",          ar: "أو اضغط"       },
  home_to_generate:     { en: "to generate",       ar: "للتوليد"       },

  // Progress
  home_generating:      { en: "Generating",        ar: "جاري التوليد"  },
  home_refining:        { en: "Refining",          ar: "جاري التحسين"  },
  home_building_3d:     { en: "Building 3D",       ar: "بناء 3D"       },
  home_synth_blueprint: { en: "Synthesizing blueprint...", ar: "جاري تركيب التصميم..." },
  home_refining_quality:{ en: "Refining quality...",       ar: "جاري تحسين الجودة..." },
  home_building_3d_geo: { en: "Building 3D geometry...",   ar: "جاري بناء الشكل ثلاثي الأبعاد..." },
  home_steps:           { en: "steps",             ar: "خطوة"          },

  // Results
  home_ai_blueprint:    { en: "AI Blueprint",      ar: "التصميم بالذكاء الاصطناعي" },
  home_completed:       { en: "completed",         ar: "مكتمل"         },
  home_factory_match:   { en: "Factory Match",     ar: "مطابقة المصنع"  },
  home_match_score:     { en: "Match score",       ar: "نسبة المطابقة"  },
  home_no_match:        { en: "No factory match available", ar: "لا يوجد مطابقة متاحة" },
  home_catalog_building:{ en: "The product catalog is being built. You can still use your AI-generated design.",
                          ar: "جاري بناء كتالوج المنتجات. يمكنك استخدام التصميم المولّد." },
  home_catalog_empty:   { en: "Catalog is empty",  ar: "الكتالوج فارغ"  },
  home_add_via_upload:  { en: "Add factory products via the Upload tab to enable matching.",
                          ar: "أضف منتجات المصنع عبر تبويب الرفع لتفعيل المطابقة." },
  home_upload_products: { en: "Upload products",   ar: "رفع منتجات"    },
  home_download_2d:     { en: "Download 2D",       ar: "تحميل 2D"      },
  home_gen_3d:          { en: "Gen 3D",            ar: "توليد 3D"      },
  home_building:        { en: "Building...",        ar: "جاري البناء..." },
  home_save:            { en: "Save",              ar: "حفظ"           },
  home_saving:          { en: "Saving...",          ar: "جاري الحفظ..." },
  home_3d_preview:      { en: "3D Preview",        ar: "معاينة 3D"     },
  home_interactive:     { en: "INTERACTIVE",        ar: "تفاعلي"        },
  home_fullscreen:      { en: "Fullscreen",         ar: "شاشة كاملة"    },
  home_view_ar:         { en: "View in AR",         ar: "عرض AR"        },
  home_download:        { en: "Download",           ar: "تحميل"         },
  home_drag_rotate:     { en: "Drag to rotate · Scroll to zoom", ar: "اسحب للتدوير · مرر للتكبير" },
  home_hit_gen_3d:      { en: 'Hit "Gen 3D" to build the 3D model', ar: 'اضغط "توليد 3D" لبناء النموذج ثلاثي الأبعاد' },
  home_building_model:  { en: "Building 3D model...", ar: "جاري بناء النموذج ثلاثي الأبعاد..." },
  home_takes_4min:      { en: "This takes ~4 minutes. You can browse other pages.",
                          ar: "يستغرق حوالي ٤ دقائق. يمكنك تصفح صفحات أخرى." },
  home_how_design:      { en: "How's this design?", ar: "ما رأيك في التصميم؟" },
  home_love_it:         { en: "Love it",           ar: "أعجبني"        },
  home_regenerate:      { en: "Regenerate",         ar: "إعادة توليد"   },
  home_no_close_match:  { en: "No close match found", ar: "لم يتم العثور على تطابق قريب" },
  home_no_product_img:  { en: "No product image",  ar: "لا توجد صورة للمنتج" },
  home_ar_title:        { en: "Augmented Reality",  ar: "الواقع المعزز"  },
  home_scan_qr:         { en: "Scan to view this exact design in AR", ar: "امسح لعرض هذا التصميم في الواقع المعزز" },

  // ── Login page ──
  login_access:         { en: "Access Required",    ar: "تسجيل الدخول مطلوب" },
  login_signin:         { en: "Sign in",            ar: "تسجيل الدخول"  },
  login_username:       { en: "Username",           ar: "اسم المستخدم"  },
  login_password:       { en: "Password",           ar: "كلمة المرور"   },
  login_forgot:         { en: "Forgot password?",   ar: "نسيت كلمة المرور؟" },
  login_signin_btn:     { en: "Sign in →",          ar: "دخول →"        },
  login_no_account:     { en: "Don't have an account?", ar: "ليس لديك حساب؟" },
  login_register:       { en: "Register",           ar: "سجّل"          },

  // ── Register page ──
  reg_create:           { en: "Create Account",     ar: "إنشاء حساب"    },
  reg_username:         { en: "Username",           ar: "اسم المستخدم"  },
  reg_email:            { en: "Email",              ar: "البريد الإلكتروني" },
  reg_password:         { en: "Password",           ar: "كلمة المرور"   },
  reg_confirm:          { en: "Confirm Password",   ar: "تأكيد كلمة المرور" },
  reg_create_btn:       { en: "Create account",     ar: "إنشاء حساب"    },
  reg_creating:         { en: "Creating account…",  ar: "جاري إنشاء الحساب…" },
  reg_has_account:      { en: "Already have an account?", ar: "لديك حساب بالفعل؟" },
  reg_signin:           { en: "Sign in",            ar: "تسجيل الدخول"  },

  // ── Forgot password flow ──
  fp_reset:             { en: "Password Reset",     ar: "إعادة تعيين كلمة المرور" },
  fp_forgot_q:          { en: "Forgot password?",   ar: "نسيت كلمة المرور؟" },
  fp_enter_email:       { en: "Enter your email address. We'll send a 6-digit code.",
                          ar: "أدخل بريدك الإلكتروني. سنرسل لك رمزاً من ٦ أرقام." },
  fp_email:             { en: "Email",              ar: "البريد الإلكتروني" },
  fp_send_code:         { en: "Send code →",        ar: "إرسال الرمز →"  },
  fp_verification:      { en: "Verification",       ar: "التحقق"         },
  fp_enter_code:        { en: "Enter the code",     ar: "أدخل الرمز"     },
  fp_code_sent:         { en: "A 6-digit code was sent to", ar: "تم إرسال رمز من ٦ أرقام إلى" },
  fp_verifying:         { en: "Verifying…",         ar: "جاري التحقق…"   },
  fp_didnt_receive:     { en: "Didn't receive it?", ar: "لم يصلك الرمز؟" },
  fp_resend_code:       { en: "Resend code",        ar: "إعادة إرسال"    },
  fp_resend_in:         { en: "Resend in",          ar: "إعادة إرسال بعد" },
  fp_new_password:      { en: "New Password",       ar: "كلمة مرور جديدة" },
  fp_set_new:           { en: "Set a new password", ar: "تعيين كلمة مرور جديدة" },
  fp_strong_hint:       { en: "Choose something strong — at least 6 characters.",
                          ar: "اختر كلمة مرور قوية — ٦ أحرف على الأقل." },
  fp_at_least_6:        { en: "At least 6 characters", ar: "٦ أحرف على الأقل" },
  fp_confirm:           { en: "Confirm Password",   ar: "تأكيد كلمة المرور" },
  fp_no_match:          { en: "Passwords don't match", ar: "كلمتا المرور غير متطابقتين" },
  fp_set_btn:           { en: "Set new password →", ar: "تعيين كلمة المرور →" },
  fp_updated:           { en: "Password updated!",  ar: "تم تحديث كلمة المرور!" },
  fp_updated_desc:      { en: "Your new password is active. You can now sign in with your new credentials.",
                          ar: "كلمة المرور الجديدة فعالة. يمكنك الآن تسجيل الدخول." },
  fp_back:              { en: "Back to sign in",    ar: "العودة لتسجيل الدخول" },

  // ── Saved page ──
  saved_vault:          { en: "Vault",              ar: "الخزنة"        },
  saved_blueprints:     { en: "Saved Blueprints",   ar: "التصاميم المحفوظة" },
  saved_newest:         { en: "Newest first",       ar: "الأحدث أولاً"  },
  saved_oldest:         { en: "Oldest first",       ar: "الأقدم أولاً"  },
  saved_highest:        { en: "Highest rated",      ar: "الأعلى تقييماً" },
  saved_all:            { en: "All designs",        ar: "كل التصاميم"   },
  saved_rated:          { en: "Rated only",         ar: "المقيّمة فقط"  },
  saved_has3d:          { en: "Has 3D",             ar: "مع 3D"         },
  saved_delete:         { en: "Delete",             ar: "حذف"           },
  saved_deleting:       { en: "Deleting...",        ar: "جاري الحذف..." },
  saved_delete_title:   { en: "Delete this design?", ar: "حذف هذا التصميم؟" },
  saved_delete_desc:    { en: "This removes it from your saved collection. The action cannot be undone.",
                          ar: "سيتم إزالته من مجموعتك المحفوظة. لا يمكن التراجع عن هذا الإجراء." },
  saved_cancel:         { en: "Cancel",             ar: "إلغاء"         },
  saved_designs:        { en: "designs",            ar: "تصاميم"        },
  saved_design:         { en: "design",             ar: "تصميم"         },
  saved_no_match:       { en: "No designs match this filter", ar: "لا توجد تصاميم تطابق هذا الفلتر" },
  saved_try_filter:     { en: "Try changing the filter above.", ar: "جرب تغيير الفلتر أعلاه." },
  saved_no_designs:     { en: "No saved designs yet", ar: "لا توجد تصاميم محفوظة بعد" },
  saved_gen_first:      { en: "Generate a design and hit Save.", ar: "أنشئ تصميماً واضغط حفظ." },
  saved_generate_first: { en: "Generate your first design", ar: "أنشئ تصميمك الأول" },
  saved_clear_filter:   { en: "Clear filter",       ar: "مسح الفلتر"    },

  // ── History page ──
  hist_timeline:        { en: "Session Log",        ar: "الجدول الزمني"  },
  hist_prompt:          { en: "Prompt History",     ar: "سجل الأوامر"   },
  hist_clear:           { en: "Clear all",          ar: "مسح الكل"      },
  hist_no_history:      { en: "No history yet",     ar: "لا يوجد سجل بعد" },
  hist_gen_first:       { en: "Generate your first design and it'll appear here.",
                          ar: "أنشئ تصميمك الأول وسيظهر هنا." },
  hist_use:             { en: "Use",                ar: "استخدام"       },

  // ── Upload page ──
  upload_admin:         { en: "Admin Panel",        ar: "لوحة المدير"   },
  upload_ref:           { en: "Upload a reference.", ar: "رفع مرجع."    },
  upload_catalog:       { en: "↑ Upload Catalog",   ar: "↑ رفع كتالوج"  },
  upload_inbox:         { en: "Inbox — Requests",   ar: "صندوق الوارد — الطلبات" },
  upload_drag:          { en: "Drag & drop your file", ar: "اسحب وأفلت الملف" },
  upload_desc:          { en: "Description",        ar: "الوصف"         },
  upload_add:           { en: "Add to Catalog  ›",  ar: "إضافة للكتالوج  ›" },
  upload_processing:    { en: "Processing...",      ar: "جاري المعالجة..." },
  upload_added:         { en: "Added to Catalog!",  ar: "تمت الإضافة للكتالوج!" },
  upload_requests:      { en: "Product Requests",   ar: "طلبات المنتجات" },
  upload_pending:       { en: "requests pending",   ar: "طلبات معلقة"   },
  upload_no_requests:   { en: "No requests yet",    ar: "لا يوجد طلبات"  },
  upload_refresh:       { en: "Refresh",            ar: "تحديث"         },
  upload_desc_hint:     { en: "Be specific — material, color, dimensions, finish",
                          ar: "كن دقيقاً — الخامة، اللون، الأبعاد، التشطيب" },
  upload_chars:         { en: "chars",              ar: "حرف"           },

  // ── Catalog management ──
  cat_tab:              { en: "My References",      ar: "مرجعياتي"       },
  cat_manage:           { en: "Manage References.", ar: "إدارة المراجع."  },
  cat_references:       { en: "references",         ar: "مرجع"           },
  cat_empty:            { en: "No references uploaded yet", ar: "لا يوجد مراجع بعد" },
  cat_edit:             { en: "Edit",               ar: "تعديل"          },
  cat_delete:           { en: "Delete",             ar: "حذف"            },
  cat_save:             { en: "Save",               ar: "حفظ"            },
  cat_cancel:           { en: "Cancel",             ar: "إلغاء"          },
  cat_deleted:          { en: "Reference deleted",  ar: "تم حذف المرجع"  },
  cat_updated:          { en: "Description updated",ar: "تم تحديث الوصف"  },

  // ── Product Request page ──
  req_custom:           { en: "Custom Order",       ar: "طلب مخصص"      },
  req_title:            { en: "Request a product.", ar: "اطلب منتجاً."  },
  req_desc:             { en: "Can't find what you need? Fill in the details below and the factory team will review your request.",
                          ar: "لم تجد ما تبحث عنه؟ املأ التفاصيل وسيراجعها فريق المصنع." },
  req_category:         { en: "Category",           ar: "الفئة"         },
  req_other:            { en: "Other",              ar: "أخرى"          },
  req_material:         { en: "Preferred Material",  ar: "الخامة المفضلة" },
  req_qty:              { en: "Qty",                ar: "الكمية"        },
  req_color_finish:     { en: "Color / Finish (optional)", ar: "اللون / التشطيب (اختياري)" },
  req_dimensions:       { en: "Approx. Dimensions (optional)", ar: "الأبعاد التقريبية (اختياري)" },
  req_details:          { en: "Additional Details *", ar: "تفاصيل إضافية *" },
  req_submit:           { en: "Submit Request",     ar: "إرسال الطلب"   },
  req_submitting:       { en: "Submitting...",       ar: "جاري الإرسال..." },
  req_submitted:        { en: "Request Submitted!",  ar: "تم إرسال الطلب!" },
  req_chars:            { en: "chars",              ar: "حرف"           },
  req_more_required:    { en: "more chars required", ar: "أحرف أخرى مطلوبة" },
  req_good:             { en: "Good",               ar: "جيد"           },

  // Material options for request page
  req_mat_wood:         { en: "Wood",               ar: "خشب"           },
  req_mat_fabric:       { en: "Fabric",             ar: "قماش"          },
  req_mat_metal:        { en: "Metal",              ar: "معدن"          },
  req_mat_leather:      { en: "Leather",            ar: "جلد"           },
  req_mat_mixed:        { en: "Mixed",              ar: "مختلط"         },
  req_mat_other:        { en: "Other",              ar: "أخرى"          },

  // Placeholder texts for request page
  req_ph_furniture:     { en: "What type of furniture? (e.g. Bed frame, Wardrobe, Bookshelf...)",
                          ar: "ما نوع الأثاث؟ (مثل: سرير، دولاب، رف كتب...)" },
  req_ph_color:         { en: "e.g. Dark walnut, Off-white...",
                          ar: "مثال: جوز داكن، أوف وايت..." },
  req_ph_dimensions:    { en: "e.g. 2m × 1m × 0.8m",
                          ar: "مثال: ٢م × ١م × ٠.٨م" },
  req_ph_details:       { en: "Describe the style, usage, special requirements... Be as specific as possible.",
                          ar: "صف الأسلوب، الاستخدام، المتطلبات الخاصة... كن دقيقاً قدر الإمكان." },
};

export function t(key: string, lang: Language): string {
  return _i18n[key]?.[lang] ?? key;
}

// Map configurator schema labels to i18n keys for translating field/option labels
const _labelToKey: Record<string, string> = {
  // Category labels
  "Chair": "cat_chair", "Sofa": "cat_sofa", "Table": "cat_table",
  // Type labels
  "Chair Type": "type_chair", "Sofa Type": "type_sofa", "Table Type": "type_table",
  "Armchair": "type_armchair", "Office Chair": "type_office_chair",
  "Lounge Chair": "type_lounge_chair", "Gaming Chair": "type_gaming_chair",
  "Sectional Sofa": "type_sectional_sofa", "Loveseat": "type_loveseat",
  "Ottoman Sofa": "type_ottoman_sofa",
  "Coffee Table": "type_coffee_table", "Dining Table": "type_dining_table",
  "End Table": "type_end_table", "Side Table": "type_side_table",
  // Color labels
  "Color": "label_color",
  "White": "color_white", "Beige": "color_beige", "Gray": "color_gray",
  "Brown": "color_brown", "Black": "color_black", "Blue": "color_blue",
  "Green": "color_green", "Red": "color_red", "Orange": "color_orange",
  "Pink": "color_pink", "Tan": "color_tan",
  // Material labels
  "Material": "label_material",
  "Fabric": "mat_fabric", "Leather": "mat_leather", "Mesh": "mat_mesh",
  "Linen": "mat_linen", "Microfiber": "mat_microfiber", "Velvet": "mat_velvet",
  "Metal": "mat_metal", "Wooden": "mat_wooden", "Marble": "mat_marble", "Glass": "mat_glass",
  // Back style labels
  "Back Style": "label_back_style",
  "Low Back": "back_low", "High Back": "back_high", "Padded Back": "back_padded",
  "Upholstered Back": "back_upholstered", "Curved Back": "back_curved",
  "Plain Back": "back_plain", "Soft Back": "back_soft", "Straight Back": "back_straight",
  "Plush Back": "back_plush", "Rounded Back": "back_rounded",
  // Features labels
  "Features": "label_features",
  "With Armrests": "feat_armrests", "With Wheels": "feat_wheels",
  "Without Wheels": "feat_no_wheels", "Recliner": "feat_recliner",
  // Shape labels
  "Shape": "label_shape",
  "Rectangle": "shape_rectangle", "Square": "shape_square",
  "Round": "shape_round", "Oval": "shape_oval",
  // Legs labels
  "Legs": "label_legs",
  "Metal Legs": "legs_metal", "Wood Legs": "legs_wood",
};

/** Translate a schema label (field.label or option.label) to the current language */
export function tLabel(label: string, lang: Language): string {
  const key = _labelToKey[label];
  if (!key) return label;
  return _i18n[key]?.[lang] ?? label;
}
