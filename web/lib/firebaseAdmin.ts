// lib/firebaseAdmin.ts
// Server-only Firebase Admin init for the vote API routes (app/api/vote,
// app/api/tally). NEVER import this from a 'use client' file: it reads a
// service-account secret from the environment and uses Node-only APIs that
// have no business in the browser bundle.
//
// Mirrors the pattern simulation/firebase.ts already uses in production: the
// credential comes from the FIREBASE_SERVICE_ACCOUNT env var (a JSON blob),
// never from a committed file. See web/.env.example.
//
// This module only ever touches Firestore (voteTallies/{cycleId}) — it never
// requests a databaseURL, so it has no path to the /live RTDB node the sim
// owns. That's a structural guarantee, not just a convention: the vote path
// must never write worlds/world_sample_01 or /live.
import admin from 'firebase-admin';

let app: admin.app.App | null = null;

export function isFirebaseConfigured(): boolean {
  return (process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim().length > 0;
}

function getApp(): admin.app.App {
  if (app !== null) return app;

  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (envJson === undefined || envJson.trim().length === 0) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set — cannot init Firebase Admin');
  }

  // In dev, Next's module reloads can re-run this file; reuse an existing app
  // instance rather than throwing "app already exists".
  if (admin.apps.length > 0 && admin.apps[0] !== null) {
    app = admin.apps[0];
    return app;
  }

  const serviceAccount = JSON.parse(envJson) as admin.ServiceAccount;
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  return app;
}

export function getVoteFirestore(): admin.firestore.Firestore {
  return admin.firestore(getApp());
}

export const FieldValue = admin.firestore.FieldValue;
