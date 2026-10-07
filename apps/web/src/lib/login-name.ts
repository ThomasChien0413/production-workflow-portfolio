/** A login name is shown separately only for a real alias (including admin). */
export function customLoginName(user: { username: string; displayName: string }): string | null {
  const normalized = (value: string) => value.trim().normalize("NFC").toLowerCase();
  return normalized(user.username) === normalized(user.displayName) ? null : user.username;
}
