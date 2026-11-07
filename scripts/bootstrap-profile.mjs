// Run before opening an existing Desktop profile. First sign-in creates its account scope;
// later launches can copy local Code chats and Personal's sidebar into the closed profile.
import { findWindowsDesktopProfiles, syncDesktopSessionRecordsMany,
  repairEmptyDesktopSessionRecords, repairStaleDesktopSessionRecords } from '../server/desktop-chat-sync.js';
import { syncMergedDesktopLabelsMany } from '../server/desktop-label-sync.js';

const targetId = String(process.argv[2] || '').toLowerCase();
if (!/^[a-z][a-z0-9]{0,31}$/.test(targetId) || targetId === 'personal') process.exit(1);

try {
  const profiles = findWindowsDesktopProfiles();
  if (!profiles[targetId]) process.exit(0); // first launch: sign-in has not created a session scope yet
  const chats = syncDesktopSessionRecordsMany(profiles, { propagateDeletions: false, inspectConflicts: false });
  let repaired = 0;
  for (const source of Object.keys(profiles).filter((id) => id !== targetId)) {
    repaired += repairEmptyDesktopSessionRecords(profiles[source], profiles[targetId], { targetProfile: 'work' });
    repaired += repairStaleDesktopSessionRecords(profiles[source], profiles[targetId],
      { targetProfile: 'work', preferLatestTranscript: true });
  }
  let groups = 'pending';
  try {
    const labels = await syncMergedDesktopLabelsMany(profiles, { sourceId: 'personal', targetIds: [targetId] });
    groups = `${labels.groups} groups, ${labels.assignments} assignments`;
  } catch (error) {
    console.warn(`Sidebar sync pending: ${error.message}`);
  }
  console.log(`Chats copied to ${targetId}: ${chats.copied[targetId] || 0}; pointers repaired: ${repaired}; sidebar: ${groups}`);
} catch (error) {
  console.error(`Profile bootstrap failed: ${error.message}`);
  process.exitCode = 1;
}
