import { immich } from '../lib/immich-adapter';
async function main() {
  const version = await immich.getVersion();
  const mode = await immich.getSearchMode();
  console.log(`Immich API reachable. Version ${version.major}.${version.minor}.${version.patch}; search=${mode}`);
  console.log(`Accessible albums: ${(await immich.listAlbums()).length}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
