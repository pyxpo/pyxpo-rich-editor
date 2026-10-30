import { mergeAttributes, Node } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";

/**
 * The blocks a writer reaches for that plain text has no word for: a button,
 * a video, side-by-side columns, and a product or recipe card.
 *
 * Each one is written with inline styles as well as a class, for the same
 * reason the picture is (see `resizable-image.ts`): this HTML is served by the
 * customer's own site, where our stylesheet is not. The class is what the
 * hosted blog and the parser recognise; the style is what makes it look right
 * anywhere else.
 */

// A button or a video is one selectable unit, and after it is put in, the
// selection would be on it: the next key pressed would replace it. Each is put
// in with an empty line after it, where the cursor lands instead.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    contentBlocks: {
      insertCta: (attrs: { href: string; label: string }) => ReturnType;
      insertVideo: (url: string) => ReturnType;
      insertColumns: (count: 2 | 3) => ReturnType;
      insertProduct: (attrs: ProductAttrs) => ReturnType;
      insertRecipe: (attrs: RecipeAttrs) => ReturnType;
    };
  }
}

const CTA_BUTTON_STYLE =
  "display: inline-block; padding: 12px 22px; border-radius: 8px; background: #111827; color: #ffffff; text-decoration: none; font-weight: 600";

/** A link drawn as a button, on a line of its own. */
export const Cta = Node.create({
  name: "cta",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: "", parseHTML: (el) => el.querySelector("a")?.getAttribute("href") ?? "" },
      label: { default: "", parseHTML: (el) => el.querySelector("a")?.textContent ?? "" },
    };
  },

  parseHTML() {
    // Ahead of the paragraph's plain `p`, or a saved button opens as a line with a link in it.
    return [{ tag: "p.cmskite-cta", priority: 1000 }];
  },

  renderHTML({ node }) {
    return [
      "p",
      { class: "cmskite-cta", style: "text-align: center; margin: 28px 0" },
      ["a", { class: "cmskite-cta__button", href: node.attrs.href, style: CTA_BUTTON_STYLE }, node.attrs.label || node.attrs.href],
    ];
  },

  addCommands() {
    return {
      insertCta:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs }, { type: "paragraph" }]),
    };
  },
});

/**
 * The player address for a YouTube or Vimeo link as somebody copies it out of
 * the address bar. Anything else is refused: the hosted blog only lets frames
 * from those two hosts through, so any other address would save as a hole.
 */
export function videoEmbedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const id = (value: string | null | undefined) => (value && /^[\w-]{6,20}$/.test(value) ? value : null);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/") ? url.pathname.split("/")[2] : url.searchParams.get("v");
    return id(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "youtu.be") {
    const v = url.pathname.slice(1);
    return id(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = url.pathname.split("/").filter(Boolean).pop();
    return v && /^\d+$/.test(v) ? `https://player.vimeo.com/video/${v}` : null;
  }
  return null;
}

/** A YouTube or Vimeo player, as wide as the column and 16:9. */
export const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { src: { default: "", parseHTML: (el) => el.querySelector("iframe")?.getAttribute("src") ?? "" } };
  },

  parseHTML() {
    return [{ tag: "div.cmskite-video" }];
  },

  renderHTML({ node }) {
    return [
      "div",
      { class: "cmskite-video", style: "position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; margin: 24px 0" },
      [
        "iframe",
        {
          src: node.attrs.src,
          title: "Video",
          allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen",
          allowfullscreen: "true",
          frameborder: "0",
          loading: "lazy",
          style: "position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0",
        },
      ],
    ];
  },

  addCommands() {
    return {
      insertVideo:
        (raw) =>
        ({ commands }) => {
          const src = videoEmbedUrl(raw);
          return src ? commands.insertContent([{ type: this.name, attrs: { src } }, { type: "paragraph" }]) : false;
        },
    };
  },
});

/** One column: ordinary blocks, so anything that goes in a post goes in it. */
export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: "div.cmskite-column" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "cmskite-column", style: "flex: 1 1 240px; min-width: 0" }), 0];
  },
});

/**
 * Two or three columns side by side, which fold into one under each other on
 * a phone (the `flex-wrap` and the 240px basis do that without a media query,
 * which an inline style cannot have).
 */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,

  parseHTML() {
    return [{ tag: "div.cmskite-columns" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "cmskite-columns", style: "display: flex; flex-wrap: wrap; gap: 24px; margin: 24px 0" }), 0];
  },

  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: Array.from({ length: count }, () => ({ type: "column", content: [{ type: "paragraph" }] })),
          }),
    };
  },
});


/*
 * A product and a recipe: the two cards a post most often carries that a
 * search engine shows as more than a blue link. Both are written with
 * schema.org microdata (`itemscope` / `itemprop`), so the price, the times and
 * the ingredients reach Google from the customer's own page as well as from
 * ours, without a JSON-LD block that would have to be kept in step with the text.
 */

export interface ProductAttrs {
  name: string;
  description: string;
  image: string;
  /** The amount as typed, "19.99", and the ISO code, "USD": what the markup carries. */
  price: string;
  currency: string;
  /** The price as the reader sees it, "$19.99", formatted when the card was put in. */
  priceText: string;
  href: string;
  label: string;
}

const CARD_STYLE = "margin: 28px 0; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px";
const text = (el: HTMLElement, selector: string) => el.querySelector(selector)?.textContent?.trim() ?? "";
const attr = (el: HTMLElement, selector: string, name: string) => el.querySelector(selector)?.getAttribute(name) ?? "";

/** "$19.99" for 19.99 USD in the writer's own number format, or the two side by side when either is not one. */
export function formatPrice(price: string, currency: string): string {
  const amount = Number(price.replace(",", "."));
  if (!price.trim() || !Number.isFinite(amount)) return price.trim();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.trim().toUpperCase() }).format(amount);
  } catch {
    return `${price.trim()} ${currency.trim().toUpperCase()}`.trim();
  }
}

/** A product: picture, name, a line about it, the price and a button to where it is sold. */
export const Product = Node.create({
  name: "product",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      name: { default: "", parseHTML: (el) => text(el, "[itemprop=name]") },
      description: { default: "", parseHTML: (el) => text(el, "[itemprop=description]") },
      image: { default: "", parseHTML: (el) => attr(el, "img[itemprop=image]", "src") },
      price: { default: "", parseHTML: (el) => attr(el, "[itemprop=price]", "value") },
      currency: { default: "", parseHTML: (el) => attr(el, "[itemprop=priceCurrency]", "value") },
      priceText: { default: "", parseHTML: (el) => text(el, "[itemprop=price]") },
      href: { default: "", parseHTML: (el) => attr(el, "a", "href") },
      label: { default: "", parseHTML: (el) => text(el, "a") },
    };
  },

  parseHTML() {
    return [{ tag: "div.cmskite-product" }];
  },

  renderHTML({ node }) {
    const a = node.attrs as ProductAttrs;
    const offer = a.price
      ? [
          [
            "p",
            { itemprop: "offers", itemscope: "", itemtype: "https://schema.org/Offer", style: "margin: 0 0 14px; font-size: 17px; font-weight: 600" },
            ["data", { itemprop: "price", value: a.price }, a.priceText || a.price],
            ...(a.currency ? [["data", { itemprop: "priceCurrency", value: a.currency }]] : []),
          ],
        ]
      : [];
    return [
      "div",
      {
        class: "cmskite-product",
        itemscope: "",
        itemtype: "https://schema.org/Product",
        style: `${CARD_STYLE}; display: flex; flex-wrap: wrap; gap: 20px; align-items: center`,
      },
      ...(a.image ? [["img", { itemprop: "image", src: a.image, alt: a.name, style: "width: 160px; max-width: 100%; height: auto; border-radius: 8px" }]] : []),
      [
        "div",
        { style: "flex: 1 1 220px; min-width: 0" },
        ["p", { style: "margin: 0 0 6px; font-size: 18px; font-weight: 600" }, ["span", { itemprop: "name" }, a.name]],
        ...(a.description ? [["p", { itemprop: "description", style: "margin: 0 0 10px; color: #4b5563" }, a.description]] : []),
        ...offer,
        ...(a.href
          ? [["p", { style: "margin: 0" }, ["a", { class: "cmskite-cta__button", href: a.href, itemprop: "url", style: CTA_BUTTON_STYLE }, a.label || a.href]]]
          : []),
      ],
    ] as unknown as DOMOutputSpec;
  },

  addCommands() {
    return {
      insertProduct:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs }, { type: "paragraph" }]),
    };
  },
});

export interface RecipeLabels {
  serves: string;
  prep: string;
  cook: string;
  /** "{n} min", with the number in place. */
  minutes: string;
  ingredients: string;
  steps: string;
}

export interface RecipeAttrs {
  name: string;
  image: string;
  servings: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  ingredients: string[];
  steps: string[];
  /** The headings, in the language the card was put in with and read back out of it after. */
  labels: RecipeLabels;
}

const minutesOf = (el: HTMLElement, prop: string) => {
  const m = attr(el, `time[itemprop=${prop}]`, "datetime").match(/^PT(\d+)M$/);
  return m ? Number(m[1]) : null;
};

/** The label in front of a value: "Prep" out of `<span><strong>Prep</strong> <time …>`. */
const labelOf = (el: HTMLElement, prop: string) => el.querySelector(`[itemprop=${prop}]`)?.parentElement?.querySelector("strong")?.textContent?.trim();

export const DEFAULT_RECIPE_LABELS: RecipeLabels = {
  serves: "Serves",
  prep: "Prep",
  cook: "Cook",
  minutes: "{n} min",
  ingredients: "Ingredients",
  steps: "Steps",
};

/** A recipe card: name, picture, servings and times, the ingredients and the steps. */
export const Recipe = Node.create({
  name: "recipe",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      name: { default: "", parseHTML: (el) => text(el, "[itemprop=name]") },
      image: { default: "", parseHTML: (el) => attr(el, "img[itemprop=image]", "src") },
      servings: { default: "", parseHTML: (el) => text(el, "[itemprop=recipeYield]") },
      prepMinutes: { default: null, parseHTML: (el) => minutesOf(el, "prepTime") },
      cookMinutes: { default: null, parseHTML: (el) => minutesOf(el, "cookTime") },
      ingredients: {
        default: [],
        parseHTML: (el) => Array.from(el.querySelectorAll("[itemprop=recipeIngredient]"), (li) => li.textContent?.trim() ?? "").filter(Boolean),
      },
      steps: {
        default: [],
        parseHTML: (el) => Array.from(el.querySelectorAll("[itemprop=recipeInstructions]"), (li) => li.textContent?.trim() ?? "").filter(Boolean),
      },
      labels: {
        default: DEFAULT_RECIPE_LABELS,
        parseHTML: (el): RecipeLabels => {
          const [ingredients, steps] = Array.from(el.querySelectorAll("h4"), (h) => h.textContent?.trim() ?? "");
          const time = el.querySelector("time[itemprop]");
          const shown = time?.textContent?.trim() ?? "";
          const n = time?.getAttribute("datetime")?.match(/^PT(\d+)M$/)?.[1];
          return {
            serves: labelOf(el, "recipeYield") || DEFAULT_RECIPE_LABELS.serves,
            prep: labelOf(el, "prepTime") || DEFAULT_RECIPE_LABELS.prep,
            cook: labelOf(el, "cookTime") || DEFAULT_RECIPE_LABELS.cook,
            minutes: n && shown.includes(n) ? shown.replace(n, "{n}") : DEFAULT_RECIPE_LABELS.minutes,
            ingredients: ingredients || DEFAULT_RECIPE_LABELS.ingredients,
            steps: steps || DEFAULT_RECIPE_LABELS.steps,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div.cmskite-recipe" }];
  },

  renderHTML({ node }) {
    const a = node.attrs as RecipeAttrs;
    const l = { ...DEFAULT_RECIPE_LABELS, ...a.labels };
    const time = (prop: string, label: string, minutes: number | null) =>
      minutes
        ? [["span", {}, ["strong", {}, label], " ", ["time", { itemprop: prop, datetime: `PT${minutes}M` }, l.minutes.replace("{n}", String(minutes))]]]
        : [];
    const facts = [
      ...(a.servings ? [["span", {}, ["strong", {}, l.serves], " ", ["span", { itemprop: "recipeYield" }, a.servings]]] : []),
      ...time("prepTime", l.prep, a.prepMinutes),
      ...time("cookTime", l.cook, a.cookMinutes),
    ];
    // " · " between the facts, as text nodes of the line they sit in.
    const line = facts.flatMap((fact, i) => (i ? [" · ", fact] : [fact]));
    return [
      "div",
      { class: "cmskite-recipe", itemscope: "", itemtype: "https://schema.org/Recipe", style: CARD_STYLE },
      ["h3", { itemprop: "name", style: "margin: 0 0 12px" }, a.name],
      ...(a.image ? [["img", { itemprop: "image", src: a.image, alt: a.name, style: "width: 100%; height: auto; border-radius: 8px; margin: 0 0 12px" }]] : []),
      ...(line.length ? [["p", { style: "margin: 0 0 16px; color: #4b5563" }, ...line]] : []),
      ["h4", { style: "margin: 0 0 8px" }, l.ingredients],
      ["ul", { style: "margin: 0 0 16px" }, ...a.ingredients.map((item) => ["li", { itemprop: "recipeIngredient" }, item])],
      ["h4", { style: "margin: 0 0 8px" }, l.steps],
      [
        "ol",
        { style: "margin: 0" },
        ...a.steps.map((step) => ["li", { itemprop: "recipeInstructions", itemscope: "", itemtype: "https://schema.org/HowToStep" }, ["span", { itemprop: "text" }, step]]),
      ],
    ] as unknown as DOMOutputSpec;
  },

  addCommands() {
    return {
      insertRecipe:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs }, { type: "paragraph" }]),
    };
  },
});

export const ContentBlocks = [Cta, Video, Columns, Column, Product, Recipe];
