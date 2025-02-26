import path from 'path';

// Base path for storing enrollment videos (relative to project root)
export const BASE_ENROLLMENT_VIDEO_PATH = path.join(
  process.cwd(),
  'local-storage',
  'enrollment-videos',
);
