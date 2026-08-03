/** `public/data/**` віддається статикою; BASE_URL — щоб пережити деплой у підкаталог. */
const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

export async function fetchData<T>(relativePath: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}${relativePath}`);
  if (!res.ok) throw new Error(`${relativePath}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
