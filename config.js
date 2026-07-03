/* =========================================================================
   Configuración de conexión a Supabase.
   Reemplazá los dos valores de abajo por los de TU proyecto:
   Supabase Dashboard > Project Settings > API
     - "Project URL"      -> SUPABASE_URL
     - "anon public" key  -> SUPABASE_ANON_KEY
   Este archivo es seguro de publicar: la "anon key" está pensada para
   usarse en el navegador (el acceso real se controla con las políticas
   RLS definidas en schema.sql).
   ========================================================================= */

const SUPABASE_URL = "https://xvoehqagxobvbvsdxbip.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2b2VocWFneG9idmJ2c2R4YmlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwOTA3MDAsImV4cCI6MjA5ODY2NjcwMH0.JRAni0QxgEp6TMRm9LaLsm8pe7oTs-9r3v5QR9F7g8Y";

const PHOTOS_BUCKET = "fotos-comedor";
