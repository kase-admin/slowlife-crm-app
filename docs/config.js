// GAS Web App のデプロイURLと、Googleログイン（Identity Services）用のOAuthクライアントID。
// クライアントIDは公開して問題ない値（シークレットではない）なので、ソースに書いてよい。
// 実際のアクセス制御は、ログインしたGoogleアカウントのIDトークンをGAS側で検証し、
// スプレッドシートの「Authシート」の許可リストと照合する方式に切り替えている。
window.CRM_CONFIG = {
  API_BASE: "https://script.google.com/macros/s/AKfycbxtM_Vve-rWW1d3bylW3kL9hrgpyW9CSUPS4_j0h1MxZI6wT8fIDGJlo9Va1voZLO1NoA/exec",
  GOOGLE_CLIENT_ID: "367609792965-21jmcs72jt889tsanc6p651859h7n6p2.apps.googleusercontent.com",
};
