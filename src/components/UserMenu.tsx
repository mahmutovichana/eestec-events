/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { SignInButton } from "./SignInButton";

const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return <SignInButton />;
  return (
    <details className="um">
      <summary>
        {user.picture ? (
          <img src={user.picture} alt="" width={36} height={36} referrerPolicy="no-referrer" />
        ) : (
          <span className="av" aria-hidden="true">{initials(user.name)}</span>
        )}
        <span className="nm">{user.name}</span>
      </summary>
      <div className="menu" role="menu">
        <div className="who">
          <b>{user.name}</b>
          <span>{user.email}</span>
          {user.role === "ADMIN" ? <span className="pill PUBLISHED">Admin</span> : null}
        </div>
        <Link href="/profile" role="menuitem">Moj profil</Link>
        {user.role === "ADMIN" ? <Link href="/admin" role="menuitem">Admin panel</Link> : null}
        <a href="/auth/logout" role="menuitem">Odjavi se</a>
      </div>
    </details>
  );
}
