import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const ALLOWED_AI_EMAIL = 'rbshah0029@gmail.com';

const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemma-4-31b-it',
];

function isRetryableModelError(message: string): boolean {
  return (
    message.includes('503') ||
    message.includes('429') ||
    message.includes('404') ||
    message.includes('high demand') ||
    message.includes('overloaded') ||
    message.includes('Free Tier') ||
    message.includes('limit: 0') ||
    message.includes('no longer available')
  );
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const authHeader = request.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!supabaseUrl || !supabaseAnonKey || !token) {
      return Response.json({ error: 'Unauthorized: Please sign in to use AI features.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const userEmail = authData.user?.email?.trim().toLowerCase();

    if (authError || userEmail !== ALLOWED_AI_EMAIL) {
      return Response.json(
        { error: `AI features are only enabled for ${ALLOWED_AI_EMAIL}.` },
        { status: 403 },
      );
    }

    const body = await request.json();
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const context = typeof body.context === 'string' ? body.context.trim() : '';
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    const rawModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gemini-3.8-flash';
    const preferredModel = rawModel.startsWith('gemini-2.5-') ? 'gemini-3.8-flash' : rawModel;

    const headerKey = request.headers.get('x-gemini-key')?.trim();
    const apiKey = headerKey || process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return Response.json(
        { error: 'Missing Gemini API key. Add GEMINI_API_KEY to .env.local or set your key in Settings → AI.' },
        { status: 400 },
      );
    }

    if (!prompt) {
      return Response.json({ error: 'Prompt is required.' }, { status: 400 });
    }

    const client = new GoogleGenAI({ apiKey });
    const input = context ? `Context:\n${context}\n\nTask:\n${prompt}` : prompt;

    const candidates = [preferredModel, ...FALLBACK_MODELS.filter((m) => m !== preferredModel)];
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const interaction = await client.interactions.create({
          model: candidate,
          input,
          ...(instruction ? { system_instruction: instruction } : {}),
        });

        return Response.json({
          text: interaction.output_text ?? '',
          id: interaction.id,
          model: candidate,
        });
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!isRetryableModelError(msg)) {
          throw err;
        }
      }
    }

    throw lastError;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gemini request failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
