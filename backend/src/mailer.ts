export interface Mailer {
  sendLoginLink(to: string, link: string): Promise<void>;
}

// Пока SMTP не выбран: ссылка выводится в лог сервера.
export const consoleMailer: Mailer = {
  async sendLoginLink(to, link) {
    console.log(`[mail] login link for ${to}: ${link}`);
  },
};
