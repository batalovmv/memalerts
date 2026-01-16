import { http, HttpResponse } from 'msw';
import tokenFixture from '../fixtures/vkvideo/token.json';
import userFixture from '../fixtures/vkvideo/user.json';

export const vkvideoHandlers = [
  http.post('https://vkvideo.example.com/oauth/token', () => HttpResponse.json(tokenFixture)),
  http.get('https://vkvideo.example.com/userinfo', () => HttpResponse.json(userFixture)),
  http.get('https://vkvideo.example.com/v1/current_user', () =>
    HttpResponse.json({
      data: {
        user: {
          display_name: 'VK Video User',
          channel: { url: 'https://live.vkvideo.ru/vkvideo_user' },
        },
      },
    })
  ),
];
