import type { NextConfig } from "next";

// NEXT_DIST_DIR omogućava build/test bez diranja .next foldera pokrenutog dev servera.
const config: NextConfig = { poweredByHeader: false, distDir: process.env.NEXT_DIST_DIR || ".next" };
export default config;
