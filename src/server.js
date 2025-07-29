import express from "express";
import { ENV } from "./config/env.js";
import { db } from "./config/db.js";
import { favoritesTable } from "./db/schema.js";
import { and, eq } from "drizzle-orm";
import job from "./config/cron.js";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { sql } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = ENV.PORT || 5001;

if (ENV.NODE_ENV === "production") job.start();

app.use(express.json());

// Migration runner function
const runMigrations = async () => {
  try {
    console.log('🔄 Running database migrations...');
    
    // Fix: Point to the correct folder where your migrations are
    const migrationsFolder = path.resolve(__dirname, 'db', 'migrations');
    console.log('Migrations folder path:', migrationsFolder);
    
    await migrate(db, {
      migrationsFolder: migrationsFolder,
    });
    
    console.log('✅ Database migrations completed successfully');
    
    // Test that the table exists after migration
    const testResult = await db.select().from(favoritesTable).limit(1);
    console.log('✅ Favorites table is accessible');
    
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    console.error('Full error:', error);
    
    // Fallback: Try to create the table directly if migration fails
    try {
      console.log('🔄 Attempting direct table creation...');
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "favorites" (
          "id" serial PRIMARY KEY NOT NULL,
          "user_id" text NOT NULL,
          "recipe_id" integer NOT NULL,
          "title" text NOT NULL,
          "image" text,
          "cook_time" text,
          "servings" text,
          "created_at" timestamp DEFAULT now()
        );
      `);
      
      // Test the table
      await db.select().from(favoritesTable).limit(1);
      console.log('✅ Direct table creation successful');
      
    } catch (fallbackError) {
      console.error('❌ Direct table creation also failed:', fallbackError.message);
      
      // In production, don't crash the server, but log the error
      if (ENV.NODE_ENV === 'production') {
        console.error('⚠️ Continuing without migrations in production');
      } else {
        throw error;
      }
    }
  }
};

app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true });
});

app.post("/api/favorites", async (req, res) => {
  try {
    const { userId, recipeId, title, image, cookTime, servings } = req.body;

    if (!userId || !recipeId || !title) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newFavorite = await db
      .insert(favoritesTable)
      .values({
        userId,
        recipeId,
        title,
        image,
        cookTime,
        servings,
      })
      .returning();

    res.status(201).json(newFavorite[0]);
  } catch (error) {
    console.log("Error adding favorite", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/api/favorites/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const userFavorites = await db
      .select()
      .from(favoritesTable)
      .where(eq(favoritesTable.userId, userId));

    res.status(200).json(userFavorites);
  } catch (error) {
    console.log("Error fetching the favorites", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.delete("/api/favorites/:userId/:recipeId", async (req, res) => {
  try {
    const { userId, recipeId } = req.params;

    await db
      .delete(favoritesTable)
      .where(
        and(eq(favoritesTable.userId, userId), eq(favoritesTable.recipeId, parseInt(recipeId)))
      );

    res.status(200).json({ message: "Favorite removed successfully" });
  } catch (error) {
    console.log("Error removing a favorite", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Start server with migrations
const startServer = async () => {
  try {
    // Run migrations first
    await runMigrations();
    
    // Then start the server
    app.listen(PORT, () => {
      console.log("Server is running on PORT:", PORT);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    
    // In production, try to start anyway
    if (ENV.NODE_ENV === 'production') {
      console.log('⚠️ Starting server despite migration issues...');
      app.listen(PORT, () => {
        console.log("Server is running on PORT:", PORT, "(with migration warnings)");
      });
    } else {
      process.exit(1);
    }
  }
};

startServer();