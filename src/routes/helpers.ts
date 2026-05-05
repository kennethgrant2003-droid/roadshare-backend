import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { query } from "../db";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadBufferToCloudinary(buffer: Buffer, helperId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "roadshare/helpers",
        public_id: `helper_${helperId}_${Date.now()}`,
        resource_type: "image",
        overwrite: true,
        transformation: [
          { width: 600, height: 600, crop: "fill", gravity: "face" },
          { quality: "auto", fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error || new Error("Cloudinary upload failed"));
          return;
        }

        resolve(result.secure_url);
      }
    );

    stream.end(buffer);
  });
}

router.get("/", async (_req, res) => {
  try {
    const result = await query(`
      SELECT id, name, profile_photo_url
      FROM helpers
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:helperId/profile-picture", upload.single("profilePicture"), async (req, res) => {
  try {
    const { helperId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: "profilePicture file is required" });
    }

    const imageUrl = await uploadBufferToCloudinary(req.file.buffer, helperId);

    const result = await query(
      `
      UPDATE helpers
      SET profile_photo_url = $1
      WHERE id = $2
      RETURNING id, name, profile_photo_url
      `,
      [imageUrl, helperId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Helper not found" });
    }

    res.json({ ok: true, helper: result.rows[0] });
  } catch (error: any) {
    console.error("Helper profile picture upload failed:", error);
    res.status(500).json({
      error: error.message || "Helper profile picture upload failed",
    });
  }
});

export default router;
