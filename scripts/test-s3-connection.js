// Simple script to test S3 connection and bucket access
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file instead of .env.local
dotenv.config();

// Get credentials from environment variables
const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const bucketName = process.env.S3_BUCKET_NAME;
const endpoint = process.env.AWS_S3_ENDPOINT;

// Check if all required environment variables are set
if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
  console.error('Missing required environment variables:');
  if (!region) console.error('- AWS_REGION is not set');
  if (!accessKeyId) console.error('- AWS_ACCESS_KEY_ID is not set');
  if (!secretAccessKey) console.error('- AWS_SECRET_ACCESS_KEY is not set');
  if (!bucketName) console.error('- S3_BUCKET_NAME is not set');

  console.error('\nPlease make sure these are set in your .env file');
  process.exit(1);
}

// Initialize S3 client
const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  ...(endpoint && {
    endpoint,
    forcePathStyle: true,
  }),
});

// Function to test uploading a small file
async function testS3Connection() {
  console.log('Testing S3 connection...');
  console.log(`- Region: ${region}`);
  console.log(`- Bucket: ${bucketName}`);
  console.log(
    `- Access Key ID: ${accessKeyId.substring(0, 4)}...${accessKeyId.substring(accessKeyId.length - 4)}`,
  );

  if (endpoint) {
    console.log(`- Using custom endpoint: ${endpoint}`);
  }

  try {
    // List objects in the bucket root
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      MaxKeys: 10,
    });

    console.log('Listing objects in bucket...');
    const response = await s3Client.send(listCommand);

    console.log('\n✅ S3 connection successful!');
    console.log(`Found ${response.KeyCount} objects in the bucket`);

    if (response.Contents && response.Contents.length > 0) {
      console.log('\nFirst few objects:');
      response.Contents.forEach((item, index) => {
        console.log(`${index + 1}. ${item.Key} (${formatBytes(item.Size)})`);
      });
    }

    // Now try uploading a test file
    console.log('\nTesting upload capability...');
    const testFile = `test-file-${Date.now()}.txt`;
    const testContent = `This is a test file created on ${new Date().toISOString()}`;

    const uploadCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: `test-uploads/${testFile}`,
      Body: Buffer.from(testContent),
      ContentType: 'text/plain',
    });

    await s3Client.send(uploadCommand);
    console.log(`✅ Successfully uploaded test file: test-uploads/${testFile}`);

    return true;
  } catch (error) {
    console.error('\n❌ S3 connection failed:');
    console.error(error.message);

    // Provide more helpful error messages
    if (error.name === 'NoSuchBucket') {
      console.error(`\nThe bucket "${bucketName}" does not exist or you don't have access to it.`);
      console.error(
        'Make sure the bucket name is correct and that your AWS account has access to it.',
      );
    } else if (error.name === 'InvalidAccessKeyId') {
      console.error('\nThe Access Key ID you provided is invalid.');
      console.error('Check your AWS_ACCESS_KEY_ID environment variable.');
    } else if (error.name === 'SignatureDoesNotMatch') {
      console.error('\nThe Secret Access Key you provided is invalid.');
      console.error('Check your AWS_SECRET_ACCESS_KEY environment variable.');
    } else if (error.name === 'CredentialsProviderError') {
      console.error('\nThere was a problem with your AWS credentials.');
      console.error('Make sure both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are correct.');
    }

    console.error('\nFull error details:');
    console.error(error);

    return false;
  }
}

// Helper function to format bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Run the test
testS3Connection()
  .then((success) => {
    if (success) {
      console.log('\n✨ Your S3 setup looks good! You should be able to upload files.');
      console.log('\nTry using the standalone voice enrollment page at:');
      console.log('http://localhost:3000/voice-enrollment');
    } else {
      console.error('\n⚠️ Please fix the S3 connection issues before proceeding.');
    }
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
  });
