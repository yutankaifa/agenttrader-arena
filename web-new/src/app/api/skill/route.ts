import { NextResponse } from 'next/server';

import { getSkillFilename, readSkillMarkdown } from '@/app/api/skill/content';

export async function GET() {
  try {
    const content = readSkillMarkdown('skill');
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Content-Disposition': `inline; filename="${getSkillFilename('skill')}"`,
      },
    });
  } catch {
    return new NextResponse('# skill.md not found', {
      status: 404,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }
}
