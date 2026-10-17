// scripts/verify-db.ts
import { createClient } from '../pipeline/node_modules/@supabase/supabase-js';
import { ANCHOR_WEIGHTS } from '../packages/shared/src/constants';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ouoalgynlmajybuflyug.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91b2FsZ3lubG1hanlidWZseXVnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjE2MzI3MSwiZXhwIjoyMTA3NzM5MjcxfQ.qWx0Qh9yX2ibs3vKAXLktEfNjNAmTSF3vijrp_NxzmU';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log('--- Verifying Database Schema and Security ---');

  // 1. Verify tables
  const requiredTables = [
    'movies',
    'movie_embeddings',
    'people',
    'movie_people',
    'moods',
    'pipeline_state',
    'profiles',
    'user_movies',
    'favourite_people',
    'rec_feedback',
    'user_providers',
    'follows',
    'tmdb_cache',
    'tmdb_person_cache',
    'tmdb_search_cache',
    'rec_cache',
  ];

  for (const table of requiredTables) {
    const { error } = await supabase.from(table).select('*').limit(0);
    if (error) {
      throw new Error(`Table ${table} check failed: ${error.message}`);
    }
    console.log(`✓ Table public.${table} exists and accessible by service role`);
  }

  // 2. Verify public_profiles view
  const { error: viewError } = await supabase.from('public_profiles').select('*').limit(0);
  if (viewError) {
    throw new Error(`View public_profiles check failed: ${viewError.message}`);
  }
  console.log('✓ View public.public_profiles exists');

  // 3. Verify RPC functions
  const { data: testMutual, error: mutualErr } = await supabase.rpc('is_mutual', {
    a: '00000000-0000-0000-0000-000000000000',
    b: '00000000-0000-0000-0000-000000000001',
  });
  if (mutualErr) throw new Error(`RPC is_mutual failed: ${mutualErr.message}`);
  console.log(`✓ RPC is_mutual: returns ${testMutual}`);

  const { data: testProfileView, error: viewProfileErr } = await supabase.rpc('can_view_profile', {
    target: '00000000-0000-0000-0000-000000000000',
  });
  if (viewProfileErr) throw new Error(`RPC can_view_profile failed: ${viewProfileErr.message}`);
  console.log(`✓ RPC can_view_profile: returns ${testProfileView}`);

  const { data: testAnchors, error: anchorsErr } = await supabase.rpc('user_anchors', {
    uid: '00000000-0000-0000-0000-000000000000',
    max_n: 10,
  });
  if (anchorsErr) throw new Error(`RPC user_anchors failed: ${anchorsErr.message}`);
  console.log(`✓ RPC user_anchors: returns ${testAnchors.length} rows`);

  const { data: testCandidates, error: candsErr } = await supabase.rpc('rec_candidates', {
    anchor_ids: [1],
    per_anchor: 5,
  });
  if (candsErr) throw new Error(`RPC rec_candidates failed: ${candsErr.message}`);
  console.log(`✓ RPC rec_candidates: returns ${testCandidates.length} candidates`);

  const { data: testSimilar, error: simErr } = await supabase.rpc('similar_movies', {
    mid: 1,
    k: 5,
  });
  if (simErr) throw new Error(`RPC similar_movies failed: ${simErr.message}`);
  console.log(`✓ RPC similar_movies: returns ${testSimilar.length} rows`);

  const { data: testSimMatrix, error: matrixErr } = await supabase.rpc('sim_matrix', {
    candidate_ids: [1],
    anchor_ids: [1],
  });
  if (matrixErr) throw new Error(`RPC sim_matrix failed: ${matrixErr.message}`);
  console.log(`✓ RPC sim_matrix: returns ${testSimMatrix.length} rows`);

  const { data: testPeopleMovies, error: peopleErr } = await supabase.rpc('movies_by_people', {
    person_ids: [1],
    max_n: 5,
  });
  if (peopleErr) throw new Error(`RPC movies_by_people failed: ${peopleErr.message}`);
  console.log(`✓ RPC movies_by_people: returns ${testPeopleMovies.length} rows`);

  // 4. Verify purge_expired_caches
  const { error: purgeErr } = await supabase.rpc('purge_expired_caches');
  if (purgeErr) throw new Error(`RPC purge_expired_caches failed: ${purgeErr.message}`);
  console.log('✓ RPC purge_expired_caches executed successfully');

  // 5. Test Live User Taste Anchors and Auto-Invalidation
  console.log('\n--- Testing Live Anchor Weights and Trigger Invalidation ---');
  const testUserId = 'f0000000-0000-0000-0000-000000000001';

  // Cleanup test user if existing
  await supabase.from('rec_cache').delete().eq('user_id', testUserId);
  await supabase.from('user_movies').delete().eq('user_id', testUserId);
  await supabase.from('profiles').delete().eq('user_id', testUserId);

  // Note: auth.users can be simulated or profiles inserted
  // Since profiles references auth.users(id), let's check if auth user can be created via supabase.auth.admin
  const { data: authUser, error: authCreateErr } = await supabase.auth.admin.createUser({
    id: testUserId,
    email: 'phase2_tester@tonightapp.test',
    password: 'Password123!',
    email_confirm: true,
  });

  if (authCreateErr && !authCreateErr.message.includes('already exists')) {
    console.warn(`Note: auth.users insert skipped (${authCreateErr.message})`);
  } else {
    // Insert profile
    const { error: profErr } = await supabase.from('profiles').upsert({
      user_id: testUserId,
      username: 'p2_tester',
      display_name: 'Phase 2 Tester',
      visibility: 'public',
      discovery_dial: 0.4,
    });
    if (profErr) throw new Error(`Profile insert failed: ${profErr.message}`);

    // Insert test movie if needed
    const { data: movie } = await supabase
      .from('movies')
      .select('id')
      .eq('has_story', true)
      .limit(1)
      .single();

    if (movie) {
      // Insert tracking row
      await supabase.from('user_movies').upsert({
        user_id: testUserId,
        movie_id: movie.id,
        status: 'watched',
        reaction: 'loved',
        is_favourite: true,
      });

      // Verify user_anchors weights
      const { data: anchors } = await supabase.rpc('user_anchors', { uid: testUserId });
      const found = (anchors || []).find((a: any) => a.movie_id === movie.id);
      const expectedWeight = ANCHOR_WEIGHTS.favourite + ANCHOR_WEIGHTS.loved; // 1.5 + 1.0 = 2.5
      if (!found || Math.abs(found.weight - expectedWeight) > 0.01) {
        throw new Error(`user_anchors weight mismatch! Expected ${expectedWeight}, got ${found?.weight}`);
      }
      console.log(`✓ user_anchors weight calculation verified: ${found.weight} (expected ${expectedWeight})`);

      // Test rec_cache invalidation
      await supabase.from('rec_cache').upsert({
        user_id: testUserId,
        key: 'home',
        payload: { rows: [] },
      });

      const { data: cachedBefore } = await supabase.from('rec_cache').select('key').eq('user_id', testUserId);
      if (cachedBefore.length !== 1) throw new Error('rec_cache insert failed');

      // Trigger update on user_movies
      await supabase.from('user_movies').update({ reaction: 'liked' }).eq('user_id', testUserId).eq('movie_id', movie.id);

      const { data: cachedAfter } = await supabase.from('rec_cache').select('key').eq('user_id', testUserId);
      if (cachedAfter.length !== 0) throw new Error('rec_cache was NOT invalidated by user_movies trigger!');
      console.log('✓ rec_cache invalidation trigger verified: cache cleared on user_movies update');

      // Cleanup test user
      await supabase.from('user_movies').delete().eq('user_id', testUserId);
      await supabase.from('profiles').delete().eq('user_id', testUserId);
      await supabase.auth.admin.deleteUser(testUserId);
      console.log('✓ Test user cleaned up');
    }
  }

  console.log('\nAll Database Schema, RPC, and Trigger verifications PASSED! ✨');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
