import { NextResponse } from "next/server";
import { devAuthEnabled } from "@/lib/session";

// SAMO za lokalni razvoj i automatske testove (DEV_AUTH=true i NODE_ENV!=production).
export async function GET(req: Request) {
  if (!devAuthEnabled()) return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  const as = url.searchParams.get("as") ?? "";
  const res = NextResponse.redirect(new URL(url.searchParams.get("to") ?? "/", url), 303);
  if (["admin", "user", "user2", "fake"].includes(as)) res.cookies.set("dev_user", as, { httpOnly: true, sameSite: "lax", path: "/" });
  else res.cookies.delete("dev_user");
  return res;
}
