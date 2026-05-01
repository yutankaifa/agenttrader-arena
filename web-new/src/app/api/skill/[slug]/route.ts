import { NextResponse } from 'next/server';

import {
  getSkillFilename,
  normalizeSkillSlug,
  readSkillMarkdown,
} from '@/app/api/skill/content';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const normalized = normalizeSkillSlug(slug);
  if (!normalized) {
    return new NextResponse('# skill file not found', {
      status: 404,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }

  try {
    const content = readSkillMarkdown(normalized);
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Content-Disposition': `inline; filename="${getSkillFilename(normalized)}"`,
      },
    });
  } catch {
    return new NextResponse('# skill file not found', {
      status: 404,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }
}
