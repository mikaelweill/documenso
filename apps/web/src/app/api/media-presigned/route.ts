import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getServerSession } from 'next-auth';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';

export async function POST(req: NextRequest) {
  try {
    // Secure the endpoint with authentication
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the key (path to file in S3) from request body
    const { key } = await req.json();

    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }

    // Create S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });

    // Create command for getting the object
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME || 'mikael-documenso',
      Key: key,
    });

    // Generate presigned URL (expires in 1 hour)
    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });

    return NextResponse.json({ url: presignedUrl });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return NextResponse.json({ error: 'Failed to generate presigned URL' }, { status: 500 });
  }
}
