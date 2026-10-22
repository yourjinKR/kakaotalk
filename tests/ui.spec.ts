import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

async function demoLogin(page: Page, name: string) {
  await page.goto('/');
  await page.locator('.demo-users').getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('navigation', { name: '메인 메뉴' })).toBeVisible();
  await expect(page.getByText('연결됨', { exact: true })).toBeVisible();
}

async function openChat(page: Page, name: string) {
  await page.getByRole('button', { name: '채팅', exact: true }).click();
  await page.locator('.chat-row').filter({ has: page.locator('strong', { hasText: name }) }).first().click();
  await expect(page.locator('.conversation-header').getByRole('heading', { name, exact: true })).toBeVisible();
}

async function sendMessage(page: Page, message: string) {
  await page.getByRole('textbox', { name: '메시지 입력' }).fill(message);
  await page.getByRole('button', { name: '메시지 전송' }).click();
  await expect(page.locator('.message-scroller').getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '메시지 입력' })).toHaveValue('');
}

test('두 계정의 실시간 메시지 전송, 읽음과 새로고침 후 대화 유지', async ({ page, browser, baseURL }) => {
  await mkdir(path.resolve('docs', 'screenshots'), { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '다시 만나서 반가워요' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/katalk-login.png', fullPage: true });

  await demoLogin(page, '김영');
  await openChat(page, '이지윤');
  await expect(page.locator('.message-scroller').getByText('사진 보니까 분위기가 정말 좋더라!', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/katalk-chat.png', fullPage: true });

  const recipientContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    const recipient = await recipientContext.newPage();
    await demoLogin(recipient, '이지윤');
    await openChat(recipient, '김영');
    const outgoing = '토요일 오후 2시에 카페에서 만나자! ☕';
    const reply = '좋아! 그때 보자. 이번 주 이야기도 잔뜩 가져갈게 😊';

    await sendMessage(page, outgoing);
    await expect(recipient.locator('.message-scroller').getByText(outgoing, { exact: true })).toBeVisible();
    await expect(page.locator('.message-row').filter({ hasText: outgoing }).locator('.message-unread')).toHaveCount(0);

    await sendMessage(recipient, reply);
    await expect(page.locator('.message-scroller').getByText(reply, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('navigation', { name: '메인 메뉴' })).toBeVisible();
    await openChat(page, '이지윤');
    await expect(page.locator('.message-scroller').getByText(outgoing, { exact: true })).toBeVisible();
    await expect(page.locator('.message-scroller').getByText(reply, { exact: true })).toBeVisible();
  } finally {
    await recipientContext.close();
  }
});

test('친구 숨김과 복원, 차단 시 전송 제한과 차단 해제', async ({ page }) => {
  await demoLogin(page, '김영');
  await page.getByRole('button', { name: '친구', exact: true }).click();
  const friendRow = page.locator('.list-panel .friend-row').filter({ hasText: '박민준' });
  await friendRow.click();
  await page.getByRole('dialog', { name: '친구 프로필' }).getByRole('button', { name: '친구 숨김', exact: true }).click();
  await expect(friendRow).toHaveCount(0);

  await page.getByRole('button', { name: '친구 관리', exact: true }).click();
  let manager = page.getByRole('dialog', { name: '친구 관리' });
  let managedFriend = manager.locator('.result-row').filter({ hasText: '박민준' });
  await managedFriend.getByRole('button', { name: '다시 표시' }).click();
  await expect(managedFriend).toHaveCount(0);
  await manager.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(friendRow).toBeVisible();

  await friendRow.click();
  await page.getByRole('dialog', { name: '친구 프로필' }).getByRole('button', { name: '친구 차단', exact: true }).click();
  await expect(friendRow).toHaveCount(0);
  await openChat(page, '박민준');
  await expect(page.locator('.blocked-composer')).toContainText('차단한 친구예요');
  await expect(page.getByRole('textbox', { name: '메시지 입력' })).toHaveCount(0);

  await page.getByRole('button', { name: '친구', exact: true }).click();
  await page.getByRole('button', { name: '친구 관리', exact: true }).click();
  manager = page.getByRole('dialog', { name: '친구 관리' });
  await manager.getByRole('button', { name: /^차단 친구/ }).click();
  managedFriend = manager.locator('.result-row').filter({ hasText: '박민준' });
  await managedFriend.getByRole('button', { name: '차단 해제' }).click();
  await expect(managedFriend).toHaveCount(0);
  await manager.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(friendRow).toBeVisible();
  await openChat(page, '박민준');
  await expect(page.getByRole('textbox', { name: '메시지 입력' })).toBeEnabled();
});

test('새 계정 가입, ID로 친구 추가, 그룹 채팅 생성과 저장', async ({ page }) => {
  const handle = `uitest_${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('새로운 친구');
  await page.getByRole('textbox', { name: '카톡 ID', exact: true }).fill(handle);
  await page.getByLabel('비밀번호', { exact: true }).fill('friendship1234');
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await expect(page.getByRole('navigation', { name: '메인 메뉴' })).toBeVisible();
  await page.getByRole('button', { name: '친구', exact: true }).click();
  await page.locator('.list-heading').getByRole('button', { name: '친구 추가', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: '친구 추가' });

  for (const [id, name] of [['young', '김영'], ['jiyoon', '이지윤']]) {
    await addDialog.getByRole('textbox', { name: '추가할 친구 ID' }).fill(id);
    await addDialog.getByRole('button', { name: '검색', exact: true }).click();
    const result = addDialog.locator('.result-row').filter({ hasText: name });
    await result.getByRole('button', { name: '추가', exact: true }).click();
    await expect(result.getByRole('button', { name: '추가됨', exact: true })).toBeDisabled();
  }
  await addDialog.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.locator('.list-panel .friend-row').filter({ hasText: '김영' })).toBeVisible();
  await expect(page.locator('.list-panel .friend-row').filter({ hasText: '이지윤' })).toBeVisible();

  await page.getByRole('button', { name: '채팅', exact: true }).click();
  await page.locator('.list-heading').getByRole('button', { name: '새로운 채팅', exact: true }).click();
  const groupDialog = page.getByRole('dialog', { name: '새로운 채팅' });
  await groupDialog.locator('.select-friend').filter({ hasText: '김영' }).click();
  await groupDialog.locator('.select-friend').filter({ hasText: '이지윤' }).click();
  const roomName = '우리의 새로운 시작';
  await groupDialog.getByRole('textbox', { name: '채팅방 이름', exact: true }).fill(roomName);
  await groupDialog.getByRole('button', { name: '대화 시작', exact: true }).click();
  await expect(page.locator('.conversation-header').getByRole('heading', { name: roomName, exact: true })).toBeVisible();
  await expect(page.getByText('3명의 친구와 함께', { exact: true })).toBeVisible();
  const greeting = '안녕! 우리만의 첫 그룹 대화야 💛';
  await sendMessage(page, greeting);

  await page.reload();
  await openChat(page, roomName);
  await expect(page.locator('.message-scroller').getByText(greeting, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '채팅방 정보', exact: true }).click();
  await expect(page.locator('.room-members')).toContainText('새로운 친구');
  await expect(page.locator('.room-members')).toContainText('김영');
  await expect(page.locator('.room-members')).toContainText('이지윤');
});

test('모바일 목록에서는 새 메시지를 읽지 않고 채팅을 열 때 읽음 처리', async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demoLogin(page, '김영');
  await openChat(page, '이지윤');
  await page.getByRole('button', { name: '목록으로 돌아가기', exact: true }).click();
  await expect(page.locator('.conversation')).toBeHidden();
  const chatRow = page.locator('.chat-row').filter({ has: page.locator('strong', { hasText: '이지윤' }) });
  await expect(chatRow.locator('.unread-badge')).toHaveCount(0);

  const senderContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    const sender = await senderContext.newPage();
    await demoLogin(sender, '이지윤');
    await openChat(sender, '김영');
    const message = '목록을 보고 있을 때 도착한 새 메시지 📬';
    await sendMessage(sender, message);

    await expect(chatRow).toContainText(message);
    await expect(chatRow.locator('.unread-badge')).toHaveText('1');
    const sentMessage = sender.locator('.message-row').filter({ hasText: message });
    await expect(sentMessage.locator('.message-unread')).toHaveText('1');

    await chatRow.click();
    await expect(page.locator('.message-scroller').getByText(message, { exact: true })).toBeVisible();
    await expect(sentMessage.locator('.message-unread')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '메시지 입력' })).toBeVisible();
    await expect(page.getByRole('button', { name: '메시지 전송' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: '알림 닫기', exact: true }).click();
    await page.locator('.message-scroller').getByText(message, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'docs/screenshots/katalk-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '목록으로 돌아가기', exact: true }).click();
    await expect(chatRow.locator('.unread-badge')).toHaveCount(0);
  } finally {
    await senderContext.close();
  }
});
