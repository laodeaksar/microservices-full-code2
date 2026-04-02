import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  json,
  timestamp,
  index,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// --- Tables ---

export const categories = pgTable("category", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
});

export const products = pgTable(
  "product",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    shortDescription: text("short_description").notNull(),
    description: text("description").notNull(),
    price: integer("price").notNull(),
    discount: integer("discount").default(0),

    // PostgreSQL Native Arrays
    sizes: text("sizes").array().notNull(),
    colors: text("colors").array().notNull(),

    // JSON fields with Type Casting
    images: json("images").notNull(),
    techHighlights: json("tech_highlights"), // Array of {label, icon}
    boxContents: json("box_contents"), // Array of strings
    productFeatures: json("product_features"),
    technicalSpecs: json("technical_specs"),
    certifications: json("certifications"),

    // Logic & Flags
    isHeroProduct: boolean("is_hero_product").default(false).notNull(),
    heroOrder: integer("hero_order"),
    isPublished: boolean("is_published").default(true).notNull(),

    // Inventory
    stockQuantity: integer("stock_quantity").default(0).notNull(),
    stockStatus: text("stock_status").default("in_stock").notNull(),
    lowStockThreshold: integer("low_stock_threshold").default(10).notNull(),
    soldCount: integer("sold_count").default(0).notNull(),

    // External Meta
    brand: text("brand"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    externalRawData: json("external_raw_data"),

    // Metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),

    // Foreign Key
    categorySlug: varchar("category_slug", { length: 255 })
      .notNull()
      .references(() => categories.slug),
  },
  (table) => ({
    // Indexes & Constraints
    brandIdx: index("brand_idx").on(table.brand),
    sourceIdx: index("source_idx").on(table.externalSource),
    publishedIdx: index("published_idx").on(table.isPublished),
    uniqueExternal: unique("unique_external_source").on(
      table.externalSource,
      table.externalId,
    ),
  }),
);

// --- Relations ---

export const categoryRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productRelations = relations(products, ({ one }) => ({
  category: one(categories, {
    fields: [products.categorySlug],
    references: [categories.slug],
  }),
}));
