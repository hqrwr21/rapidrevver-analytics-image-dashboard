// app/api/setup-cors/route.ts
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

export async function GET() {
  // 1. Authenticate with your Data Bucket
  const s3Data = new S3Client({
    endpoint: process.env.B2_DATA_ENDPOINT,
    region: process.env.B2_REGION || "us-west-004",
    credentials: {
      accessKeyId: process.env.B2_DATA_KEY_ID!,
      secretAccessKey: process.env.B2_DATA_APP_KEY!,
    },
    forcePathStyle: true,
  });

  // 2. Authenticate with your Image Bucket
  const s3Images = new S3Client({
    endpoint: process.env.B2_IMAGE_ENDPOINT,
    region: process.env.B2_REGION || "us-west-004",
    credentials: {
      accessKeyId: process.env.B2_IMAGE_KEY_ID!,
      secretAccessKey: process.env.B2_IMAGE_APP_KEY!,
    },
    forcePathStyle: true,
  });

  // 3. Define the open CORS rules (Crucial part: Allowing "PUT")
  const corsConfig = {
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ["*"], // Allows uploads from localhost and Vercel
          AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"], // PUT is required for our new upload method
          AllowedHeaders: ["*"], // Allows all headers including Content-Type
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  };

  try {
    // Apply rules to data bucket
    await s3Data.send(new PutBucketCorsCommand({ 
      Bucket: process.env.B2_DATA_BUCKET!, 
      ...corsConfig 
    }));

    // If you are using two different buckets, apply to the image bucket too
    if (process.env.B2_DATA_BUCKET !== process.env.B2_IMAGE_BUCKET) {
      await s3Images.send(new PutBucketCorsCommand({ 
        Bucket: process.env.B2_IMAGE_BUCKET!, 
        ...corsConfig 
      }));
    }

    return NextResponse.json({ 
      success: true, 
      message: "Backblaze CORS successfully unlocked! You can now upload massive files directly from the browser." 
    });

  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    });
  }
}