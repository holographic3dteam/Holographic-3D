// configuratorSchema.ts
// Built from full caption analysis of 2521 training images

export type Category = "chair" | "sofa" | "table";

export interface AttributeOption {
  label: string;
  value: string;
  hideForTypes?: string[];   // hide this option when selections["type"] is in this list
}

export interface AttributeField {
  key: string;
  label: string;
  options: AttributeOption[];
  multi?: boolean;
  hideForTypes?: string[];   // hide this field when selections["type"] is in this list
}

export interface CategorySchema {
  label: string;
  fields: AttributeField[];
}

export const SCHEMA: Record<Category, CategorySchema> = {
  chair: {
    label: "Chair",
    fields: [
      {
        key: "type",
        label: "Chair Type",
        options: [
          { label: "Armchair",      value: "armchair" },
          { label: "Office Chair",  value: "office chair" },
          { label: "Lounge Chair",  value: "lounge chair" },
          { label: "Gaming Chair",  value: "gaming chair" },
        ],
      },
      {
        key: "color",
        label: "Color",
        options: [
          { label: "White",  value: "white" },
          { label: "Beige",  value: "beige" },
          { label: "Gray",   value: "gray" },
          { label: "Brown",  value: "brown" },
          { label: "Black",  value: "black" },
          { label: "Blue",   value: "blue" },
          { label: "Green",  value: "green" },
          { label: "Red",    value: "red" },
          { label: "Orange", value: "orange" },
          { label: "Pink",   value: "pink" },
        ],
      },
      {
        key: "material",
        label: "Material",
        options: [
          { label: "Fabric",     value: "fabric" },
          { label: "Leather",    value: "leather" },
          { label: "Mesh",       value: "mesh" },
          { label: "Linen",      value: "linen" },
          { label: "Microfiber", value: "microfiber" },
          { label: "Velvet",     value: "velvet" },
          { label: "Metal",      value: "metal" },
        ],
      },
      {
        key: "back",
        label: "Back Style",
        options: [
          { label: "Low Back",       value: "low back" },
          { label: "High Back",      value: "high back" },
          { label: "Padded Back",    value: "padded back" },
          { label: "Upholstered Back", value: "upholstered back" },
          { label: "Curved Back",    value: "curved back" },
        ],
      },
      {
        key: "features",
        label: "Features",
        multi: true,
        options: [
          { label: "With Armrests",    value: "with armrests" },
          { label: "With Wheels",      value: "with wheels" },
          { label: "Without Wheels",   value: "without wheels", hideForTypes: ["gaming chair"] },
          { label: "Recliner",         value: "recliner" },
        ],
      },
    ],
  },

  sofa: {
    label: "Sofa",
    fields: [
      {
        key: "type",
        label: "Sofa Type",
        options: [
          { label: "Sectional Sofa", value: "sectional sofa" },
          { label: "Loveseat",       value: "loveseat sofa" },
          { label: "Ottoman Sofa",   value: "ottoman sofa" },
        ],
      },
      {
        key: "color",
        label: "Color",
        options: [
          { label: "White",  value: "white" },
          { label: "Beige",  value: "beige" },
          { label: "Gray",   value: "gray" },
          { label: "Brown",  value: "brown" },
          { label: "Black",  value: "black" },
          { label: "Blue",   value: "blue" },
          { label: "Green",  value: "green" },
          { label: "Red",    value: "red" },
          { label: "Orange", value: "orange" },
          { label: "Tan",    value: "tan" },
        ],
      },
      {
        key: "material",
        label: "Material",
        options: [
          { label: "Linen",      value: "linen" },
          { label: "Microfiber", value: "microfiber" },
          { label: "Leather",    value: "leather" },
          { label: "Velvet",     value: "velvet" },
        ],
      },
      {
        key: "back",
        label: "Back Style",
        hideForTypes: ["ottoman sofa"],
        options: [
          { label: "Plain Back",     value: "plain back" },
          { label: "Padded Back",    value: "padded back" },
          { label: "Soft Back",      value: "soft back" },
          { label: "Curved Back",    value: "curved back" },
          { label: "Straight Back",  value: "straight back" },
          { label: "Plush Back",     value: "plush back" },
          { label: "Rounded Back",   value: "rounded back" },
        ],
      },
      {
        key: "features",
        label: "Features",
        multi: true,
        hideForTypes: ["ottoman sofa"],
        options: [
          { label: "With Armrests", value: "with armrests" },
        ],
      },
    ],
  },

  table: {
    label: "Table",
    fields: [
      {
        key: "type",
        label: "Table Type",
        options: [
          { label: "Coffee Table", value: "coffee table" },
          { label: "Dining Table", value: "dining table" },
          { label: "End Table",    value: "end table" },
          { label: "Side Table",   value: "side table" },
        ],
      },
      {
        key: "color",
        label: "Color",
        options: [
          { label: "White",  value: "white" },
          { label: "Brown",  value: "brown" },
          { label: "Beige",  value: "beige" },
          { label: "Tan",    value: "tan" },
          { label: "Gray",   value: "gray" },
          { label: "Black",  value: "black" },
          { label: "Orange", value: "orange" },
          { label: "Green",  value: "green" },
        ],
      },
      {
        key: "material",
        label: "Material",
        options: [
          { label: "Wooden", value: "wooden" },
          { label: "Metal",  value: "metal" },
          { label: "Marble", value: "marble" },
          { label: "Glass",  value: "glass" },
        ],
      },
      {
        key: "shape",
        label: "Shape",
        options: [
          { label: "Rectangle", value: "rectangle shape" },
          { label: "Square",    value: "square shape" },
          { label: "Round",     value: "round shape" },
          { label: "Oval",      value: "oval shape" },
        ],
      },
      {
        key: "features",
        label: "Legs",
        multi: true,
        options: [
          { label: "Metal Legs", value: "metal legs" },
          { label: "Wood Legs",  value: "wood legs" },
        ],
      },
    ],
  },
};

/**
 * Build a prompt that closely matches the training caption format.
 * Format mirrors: "a [color] [material] [type], with armrests, [back], modern style, product photo, white background"
 */
export function buildPrompt(
  category: Category,
  selections: Record<string, string | string[]>
): string {
  const parts: string[] = [];

  const type     = selections["type"]     as string | undefined;
  const color    = selections["color"]    as string | undefined;
  const material = selections["material"] as string | undefined;
  const back     = selections["back"]     as string | undefined;
  const shape    = selections["shape"]    as string | undefined;
  const features = (selections["features"] as string[] | undefined) ?? [];

  // Helper: check if a field is hidden for the current type
  const fieldVisible = (key: string) => {
    const field = SCHEMA[category].fields.find(f => f.key === key);
    return !field?.hideForTypes?.includes(type ?? "");
  };

  // Core: "a [color] [material] [type]"
  const coreWords = ["a", color, material, type || category].filter(Boolean);
  parts.push(coreWords.join(" "));

  // Features (armrests, wheels, etc.) — skip if field is hidden for this type
  if (fieldVisible("features")) {
    features.forEach(f => parts.push(f));
  }

  // Shape (table only) — explicit tabletop description so SDXL doesn't default to round
  if (shape) {
    if (category === "table") {
      const shapeMap: Record<string, string> = {
        "rectangle shape": "with a rectangular tabletop",
        "square shape":    "with a square tabletop",
        "round shape":     "with a round tabletop",
        "oval shape":      "with an oval tabletop",
      };
      parts.push(shapeMap[shape] || shape);
    } else {
      parts.push(shape);
    }
  }

  // Back style — skip if field is hidden for this type
  if (back && fieldVisible("back")) parts.push(back);

  // Table-specific: reinforce standalone + no surrounding objects
  if (category === "table") {
    parts.push("standalone table");
    parts.push("one table only");
  }

  // Fixed training suffix
  parts.push("single isolated product");
  parts.push("centered");
  parts.push("studio lighting");
  parts.push("modern style");
  parts.push("product photo");
  parts.push("plain white backdrop");
  parts.push("no other objects");

  return parts.join(", ");
}

// ── Arabic value mapping ────────────────────────────────────────────────────
const _valueAr: Record<string, string> = {
  // Categories
  chair: "كرسي", sofa: "أريكة", table: "طاولة",
  // Chair types
  armchair: "كرسي بذراعين", "office chair": "كرسي مكتب",
  "lounge chair": "كرسي استرخاء", "gaming chair": "كرسي ألعاب",
  // Sofa types
  "sectional sofa": "أريكة زاوية", "loveseat sofa": "مقعد حب", "ottoman sofa": "أريكة عثمانية",
  // Table types
  "coffee table": "طاولة قهوة", "dining table": "طاولة طعام",
  "end table": "طاولة جانبية", "side table": "طاولة جانبية",
  // Colors
  white: "أبيض", beige: "بيج", gray: "رمادي", brown: "بني",
  black: "أسود", blue: "أزرق", green: "أخضر", red: "أحمر",
  orange: "برتقالي", pink: "وردي", tan: "سمرة",
  // Materials
  fabric: "قماش", leather: "جلد", mesh: "شبك", linen: "كتان",
  microfiber: "مايكروفايبر", velvet: "مخمل", metal: "معدن",
  wooden: "خشب", marble: "رخام", glass: "زجاج",
  // Back styles
  "low back": "ظهر منخفض", "high back": "ظهر عالي", "padded back": "ظهر مبطن",
  "upholstered back": "ظهر منجد", "curved back": "ظهر منحني",
  "plain back": "ظهر عادي", "soft back": "ظهر ناعم",
  "straight back": "ظهر مستقيم", "plush back": "ظهر قطيفة", "rounded back": "ظهر دائري",
  // Features
  "with armrests": "مع مساند ذراع", "with wheels": "مع عجلات",
  "without wheels": "بدون عجلات", recliner: "قابل للإمالة",
  // Shapes
  "rectangle shape": "شكل مستطيل", "square shape": "شكل مربع",
  "round shape": "شكل دائري", "oval shape": "شكل بيضاوي",
  // Legs
  "metal legs": "أرجل معدنية", "wood legs": "أرجل خشبية",
};

function ar(val: string): string { return _valueAr[val] ?? val; }

/**
 * Build the same prompt in Arabic for display when language is Arabic.
 * The AI still receives the English version — this is just for the user preview.
 */
export function buildPromptAr(
  category: Category,
  selections: Record<string, string | string[]>
): string {
  const parts: string[] = [];

  const type     = selections["type"]     as string | undefined;
  const color    = selections["color"]    as string | undefined;
  const material = selections["material"] as string | undefined;
  const back     = selections["back"]     as string | undefined;
  const shape    = selections["shape"]    as string | undefined;
  const features = (selections["features"] as string[] | undefined) ?? [];

  // Core: "[type] [material] [color]" (Arabic order — noun first)
  const coreWords = [ar(type || category), material ? ar(material) : null, color ? ar(color) : null].filter(Boolean);
  parts.push(coreWords.join(" "));

  // Features
  features.forEach(f => parts.push(ar(f)));

  // Shape
  if (shape) parts.push(ar(shape));

  // Back style
  if (back) parts.push(ar(back));

  // Fixed suffix
  parts.push("أسلوب عصري");
  parts.push("صورة منتج");
  parts.push("خلفية بيضاء");

  return parts.join("، ");
}

