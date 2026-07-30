# 灵犀（Lingual Insight）隐私政策

**生效日期：2026 年 7 月 30 日**  
**适用版本：2.1.0 及以后版本**

灵犀是一款用于网页双语翻译、划词翻译、输入框翻译和网页视频字幕翻译的浏览器扩展。本政策说明灵犀如何处理用户数据。

## 1. 单一用途

灵犀的单一用途是帮助用户翻译和理解网页、选中文字、用户主动输入的内容以及网页视频字幕。

## 2. 处理的数据

为了提供用户主动请求的翻译功能，灵犀可能处理：

- **网站内容**：需要翻译的网页文字、选中文字、用户输入内容、字幕、页面标题和必要上下文。
- **网络记录**：当前页面地址及网站匹配信息，用于在本地应用网站规则并启用相应翻译功能。
- **身份验证信息**：用户自行填写的第三方翻译服务 API Key、访问令牌或同步凭据。
- **用户配置**：自定义提示词、术语表、翻译规则、界面设置、生词和同步配置。

灵犀不会收集健康信息、财务或付款信息、精确位置，也不会建立用于广告或画像的浏览历史数据库。

## 3. 数据用途与共享

- 网站内容仅在用户调用翻译、词典或字幕功能时，发送给用户选择的第三方翻译/API 服务。
- API 凭据仅发送给其对应的服务端点，用于完成用户请求。
- 开发者不运营用于收集翻译内容的中转服务器，不出售用户数据，不将数据用于个性化广告、信用评估或与翻译单一用途无关的分析。
- 用户主动启用同步时，配置数据会发送到用户指定的 WebDAV、自建同步服务或 GitHub Gist。
- 第三方翻译服务对数据的保留和处理受其各自隐私政策约束，用户可自行选择或更换服务。

## 4. 本地存储与保留

设置、API 配置、隐私同意记录、翻译缓存、生词和自定义规则默认保存在浏览器本地。除非用户主动启用同步，否则这些配置不会由开发者集中保存。用户可以在扩展设置中清理相关数据，也可以通过卸载扩展删除本地数据。

## 5. Chrome 权限用途

- `storage`：保存本地设置、API 配置、同意记录、缓存和生词。
- `tts`：在用户主动操作时朗读原文或译文。
- `contextMenus`：提供右键翻译、切换翻译和打开设置菜单。
- `scripting`：在当前网页中显示双语译文、划词面板、悬浮球和字幕辅助界面。
- `declarativeNetRequest` 与 `declarativeNetRequestWithHostAccess`：为翻译服务请求应用必要的跨域兼容规则。
- `<all_urls>`：让用户可在任意普通网页上主动使用网页、划词、输入框和字幕翻译。

## 6. 远程代码

灵犀不加载或执行远程托管的扩展代码。扩展运行代码包含在发布的软件包中；联网获取的网页内容、翻译结果和规则数据不属于可执行的远程代码。

## 7. Limited Use

灵犀对 Chrome API 和用户数据的使用遵守 Chrome Web Store User Data Policy 及 Limited Use 要求。数据仅用于提供或改进扩展明确披露的翻译功能。除法律、安全要求或用户主动请求支持的有限情形外，不允许人工读取用户翻译内容。

## 8. 安全与用户控制

灵犀要求联网服务使用 HTTPS，并在首次联网翻译前展示数据处理说明并取得用户明确同意。用户可以撤回同意、删除配置、关闭同步、移除 API 凭据或卸载扩展。

## 9. 政策更新

如果数据处理方式发生重大变化，本政策将更新生效日期，并在适当情况下通过扩展界面再次告知用户或重新取得同意。

## 10. 联系方式

如对本政策有疑问，请通过本仓库的 [GitHub Issues](https://github.com/359073395/hy/issues) 联系维护者。

---

# Lingual Insight Privacy Policy

**Effective date: July 30, 2026**

Lingual Insight processes only the webpage text, selected text, user-provided input, subtitles, page context, current-page matching information, credentials, and settings necessary to provide user-requested translation features. Translation content is sent only to the translation or API service selected by the user. Credentials are sent only to their corresponding service endpoints and are stored locally by default.

The developer does not sell user data, use it for personalized advertising or credit decisions, or operate a relay for collecting translation content. Optional configuration synchronization occurs only when enabled by the user and uses a destination chosen by the user. Lingual Insight does not load remotely hosted executable extension code and complies with the Chrome Web Store User Data Policy and Limited Use requirements.

Questions may be submitted through this repository's [GitHub Issues](https://github.com/359073395/hy/issues).
