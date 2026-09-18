import { signOut } from "../login/actions";

export default function Logout() {
  return (
    <div className="mx-auto max-w-sm px-5 py-20">
      <h1 className="text-h2 font-extrabold">Sign out</h1>
      <p className="mt-2 text-small text-ink-soft">This ends your console session on this device.</p>
      <form action={signOut} className="mt-6">
        <button className="btn btn-solid">Sign out</button>
      </form>
    </div>
  );
}
