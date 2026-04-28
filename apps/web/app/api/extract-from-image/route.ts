import OpenAI from 'openai'
import { NextResponse } from 'next/server'

const openai = new OpenAI()

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('image') as File | null
    if (!file) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

    // Convert to base64
    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const mimeType = file.type || 'image/jpeg'

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract all place names, restaurants, cafes, bars, attractions, or activities visible in this image. 
This is likely a screenshot of a travel recommendation (TikTok, Instagram, blog, etc.).

Return ONLY a plain text list of the places/activities you can identify, one per line.
Include any context clues like neighborhood or city if visible.
Do not include commentary, just the list of places.
If you see no recognizable places, return an empty response.`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          },
        ],
      }],
      max_tokens: 500,
    })

    const text = response.choices[0].message.content || ''
    return NextResponse.json({ text })
  } catch (e: any) {
    console.error('extract-from-image error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
