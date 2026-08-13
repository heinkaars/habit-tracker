import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

/**
 * Seeds a real account with test history, using the service role key.
 *
 * That key bypasses every RLS policy in the project, so it is not read from a
 * file here — not even a gitignored one. A key sitting in the Expo project root
 * is one rename away from `EXPO_PUBLIC_`, which Metro inlines into every
 * shipped bundle. Pass it for the single command that needs it and let it leave
 * with the process. `--env-file` supplies the public URL from `.env.local`;
 * nothing reads the key from disk:
 *
 *   SUPABASE_SERVICE_ROLE_KEY='...' \
 *     npx tsx --env-file=.env.local scripts/seed-test-data.ts
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '\nMissing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n\n' +
      "  SUPABASE_SERVICE_ROLE_KEY='...' \\\n" +
      '    npx tsx --env-file=.env.local scripts/seed-test-data.ts\n\n' +
      'Do not put the service role key in .env.local or any other file in this\n' +
      'repo — it sits next to the app bundle. Copy it from\n' +
      'Dashboard -> Project Settings -> API Keys for the one command.\n',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function seedTestData(userId: string) {
  console.log(`\nSeeding test data for user: ${userId}\n`);

  // Create habits
  const habitIds: Record<string, string> = {};
  const habits = [
    { name: 'Meditation', emoji: '🧘', kind: 'binary', target: 1 },
    { name: 'Reading', emoji: '📚', kind: 'count', target: 2 },
    { name: 'Push-ups', emoji: '💪', kind: 'count', target: 3 },
    { name: 'Water', emoji: '💧', kind: 'binary', target: 1 },
  ];

  for (const habit of habits) {
    const habitId = randomUUID();
    const { data, error } = await supabase
      .from('habits')
      .insert({
        id: habitId,
        user_id: userId,
        name: habit.name,
        emoji: habit.emoji,
        kind: habit.kind,
        target: habit.target,
        created_at: toDateKey(addDays(new Date(), -60)),
        reminder_time: Math.random() > 0.5 ? '08:00' : null,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`Error creating ${habit.name}:`, error);
      return;
    }

    habitIds[habit.name] = habitId;
    console.log(`✓ Created ${habit.name}`);
  }

  // Generate check-ins with different patterns
  const today = new Date();
  const checkIns: Array<{
    user_id: string;
    habit_id: string;
    day: string;
    count: number;
  }> = [];

  // Meditation: 42-day streak (perfect)
  for (let i = 41; i >= 0; i--) {
    checkIns.push({
      user_id: userId,
      habit_id: habitIds['Meditation'],
      day: toDateKey(addDays(today, -i)),
      count: 1,
    });
  }

  // Reading: Strong 30 days, then slipped this week
  for (let i = 29; i >= 7; i--) {
    checkIns.push({
      user_id: userId,
      habit_id: habitIds['Reading'],
      day: toDateKey(addDays(today, -i)),
      count: 2,
    });
  }
  // Last week: 30% (2 of 7 days)
  checkIns.push(
    { user_id: userId, habit_id: habitIds['Reading'], day: toDateKey(addDays(today, -6)), count: 0 },
    { user_id: userId, habit_id: habitIds['Reading'], day: toDateKey(addDays(today, -5)), count: 2 },
    { user_id: userId, habit_id: habitIds['Reading'], day: toDateKey(addDays(today, -4)), count: 0 },
    { user_id: userId, habit_id: habitIds['Reading'], day: toDateKey(addDays(today, -3)), count: 0 },
    { user_id: userId, habit_id: habitIds['Reading'], day: toDateKey(addDays(today, -2)), count: 0 },
    { user_id: userId, habit_id: habitIds['Reading'], day: toDateKey(addDays(today, -1)), count: 0 },
    { user_id: userId, habit_id: habitIds['Reading'], day: toDateKey(today), count: 2 },
  );

  // Push-ups: Consistent 1-2 reps, target 3 (only 15% completion)
  for (let i = 59; i >= 0; i--) {
    const day = addDays(today, -i);
    // Skip a few random days
    if (Math.random() > 0.8) {
      checkIns.push({
        user_id: userId,
        habit_id: habitIds['Push-ups'],
        day: toDateKey(day),
        count: 0,
      });
    } else {
      checkIns.push({
        user_id: userId,
        habit_id: habitIds['Push-ups'],
        day: toDateKey(day),
        count: Math.random() > 0.5 ? 1 : 2,
      });
    }
  }

  // Water: 85% last week, 100% today
  for (let i = 59; i >= 7; i--) {
    checkIns.push({
      user_id: userId,
      habit_id: habitIds['Water'],
      day: toDateKey(addDays(today, -i)),
      count: Math.random() > 0.15 ? 1 : 0, // 85% rate
    });
  }
  // Last week: perfect
  for (let i = 6; i >= 0; i--) {
    checkIns.push({
      user_id: userId,
      habit_id: habitIds['Water'],
      day: toDateKey(addDays(today, -i)),
      count: 1,
    });
  }

  // Insert all check-ins
  const { error: checkInError } = await supabase
    .from('check_ins')
    .insert(checkIns);

  if (checkInError) {
    console.error('Error inserting check-ins:', checkInError);
    return;
  }

  console.log(`✓ Created ${checkIns.length} check-in records\n`);
  console.log('Test data ready! You can now:');
  console.log('  • Open the app and test coaching nudges');
  console.log('  • Request a weekly reflection (last completed week)');
  console.log('  • See different habit patterns and stats');
}

// Get user from command line or .env
const testUserId = process.argv[2] || process.env.TEST_USER_ID;

if (!testUserId) {
  console.error(
    '\nUsage: npx tsx scripts/seed-test-data.ts <user-id>',
  );
  console.error('   or: TEST_USER_ID=<id> npx tsx scripts/seed-test-data.ts\n');
  process.exit(1);
}

seedTestData(testUserId).catch(console.error);
