# 灵犀（Lingual Insight）隐私政策

**生效日期：2026 年 11 月 7 日**  
**适用版本：2.4.0**

灵犀是一款帮助用户理解网页文字、选中文字、用户输入及网页视频语音的翻译扩展。本政策说明扩展处理哪些数据、处理目的、接收方、保留方式和用户控制。

## 1. 单一用途

灵犀的单一用途是语言翻译与理解，包括网页双语翻译、划词翻译、输入框翻译、词典查询、网页字幕翻译，以及用户主动开启的实时中文字幕。自动发现视频是帮助用户选择实时字幕目标页面的辅助功能。

## 2. 处理的数据

为了提供用户请求的功能，扩展可能处理：

- **网站内容**：需要翻译的文字、选区、输入内容、原字幕、标题及必要上下文。
- **标签页与媒体状态**：页面地址、网站匹配信息，以及打开实时字幕控制页后在本机读取的标签页标题、地址、视频/音频元素数量、播放、静音和发声状态。
- **标签页音频**：仅在用户另行同意、主动开始并获得浏览器授权后，处理所选标签页的音频。
- **身份验证信息**：用户自行配置的第三方 API Key、访问令牌、同步凭据及实时服务返回的临时会话凭据。
- **用户配置**：界面偏好、提示词、翻译规则、术语、生词、缓存和同步配置。

扩展不为广告或用户画像建立浏览历史数据库，也不主动索取健康、财务、付款或精确定位信息。但用户选择翻译的页面、语音或通话可能包含个人或敏感内容；请仅处理你有权使用和向所选服务发送的内容。

## 3. 自动发现视频

在实时字幕控制页打开期间，扩展在本机检测可访问的普通网页标签页，列出视频、音频及发声状态，帮助用户选择目标。候选列表可随页面状态变化、定期检测或用户点击重新检测而更新。

- 检测只读取标签页元数据和媒体状态，不读取音频样本，不抓取或下载媒体文件地址，也不因此请求翻译服务。
- 候选标题和地址仅在控制页内存中用于选择及核对页面，不上传或持久化候选列表。
- 发现视频、选择页面或点击定位，不等于同意录音；扩展不会因此自动采集或发送音频。
- 关闭控制页后停止该控制页的检测。受限网页、不可访问的嵌入内容或浏览器权限限制可能影响检测结果。

## 4. 实时音频字幕

实时中文字幕是可选功能。只有用户选择目标、确认音频处理说明、点击开始，并完成浏览器授权后才运行。

- 只捕获用户选定标签页的音频，不使用麦克风或摄像头，不采集屏幕视频。
- 运行期间，音频持续发送到用户所选的实时翻译服务，以返回中文字幕。实时模式保留网页原声，不播放翻译配音。
- 扩展不把原始音频保存为本地文件；实时字幕仅在会话期间用于控制页和原网页显示，不写入持久化字幕历史。第三方服务的数据保留方式见第 5 节。
- 更换目标页面、页面地址或服务后，需要重新确认音频同意。跨页面使用时，可能需要在目标页通过工具栏实际调用扩展，以完成浏览器的标签页级授权。
- 用户点击停止、关闭控制页、关闭或跳转/重载目标页、撤回隐私同意或捕获权限时，扩展会结束当前音频处理。停止后不会继续自动启动另一页面的捕获。
- 第三方实时服务可能按音频时长等方式收费；使用前请检查所选服务的兼容性、权限、余额及计费说明。

若用于通话，音频可能包含个人通讯及其他参与者的信息。请先取得必要许可，不要在未获授权的情况下向第三方发送他人语音。

## 5. 数据用途、接收方及共享

- 用户要求翻译或查询的内容发送到用户选择的翻译、词典或相关 API 服务；实时音频发送到用户选择的实时翻译服务。
- 接收方由接口设置中的服务名称和地址决定，可能是服务商官方接口、用户自建服务或用户指定的兼容中转服务。使用中转服务时，内容也可能由其实际接入的上游服务处理，请查阅该服务的说明。
- 用户主动调用朗读时，相关文字由所使用的浏览器、系统或所选语音服务处理。
- API 凭据在鉴权时发送到其对应服务；启用配置同步时，包含凭据的设置也可能被同步至用户指定的存储服务，详见第 6 节。
- 联网服务还可能接收建立请求所需的 IP 地址、连接及请求元数据。服务商及其受托处理方对数据的保留、访问、处理地区和使用方式适用其各自政策，并非由扩展控制。
- 扩展不会另行把翻译内容、原始音频、实时字幕或候选标签页列表发送到开发者的数据收集服务器。开发者不通过本扩展出售这些数据，不将其用于个性化广告、信用评估或与翻译单一用途无关的分析。

请根据数据敏感程度选择服务，不要向不信任的 API 或中转地址发送内容及凭据。

## 6. 本地存储、同步及保留

### 本地数据

设置、API 配置、同意记录、翻译缓存、生词及自定义规则默认保存在浏览器本地。API Key 保存在扩展配置中不等于具备独立的保险箱保护；请保护设备及浏览器配置文件，并优先使用可撤销、限额的专用凭据。

### 可选配置同步

只有用户启用并配置同步后，相关设置和其他被选择同步的数据才发送到指定的 WebDAV、自建同步服务或 GitHub Gist。设置同步可能包含第三方 API Key；同步数据按同步功能的加密配置处理。请检查同步目的地的访问权限，妥善保管加密口令，并避免公开包含凭据的配置或导出文件。

关闭同步阻止后续同步，不会自动删除远端已有副本、服务端备份或第三方日志；这些数据需在相应服务中另行管理。

### 临时会话数据

视频授权交接仅在浏览器内存级 `storage.session` 中记录目标标签页 ID、控制页 ID、服务配置标识及时间戳，不包含 API Key、页面标题、网址或音频同意。交接有效窗口为 5 分钟；记录在使用或检查过期时移除，浏览器会话结束时也会清理该会话存储。

实时连接使用的临时凭据、字幕及媒体候选列表只在相关会话或控制页中临时使用，不作为持久化历史保存。停止捕获不会要求第三方自动删除此前已收到的数据。

### 清理与删除

用户可以通过扩展提供的清理、配置管理及撤回同意功能管理本地数据，也可以通过浏览器管理或卸载扩展删除该设备的扩展本地数据。同步远端副本、手动导出文件及第三方处理的数据需要单独删除。

## 7. Chrome 权限用途

- `storage`：保存设置、凭据、同意记录、缓存和生词，并保存上述临时授权交接记录。
- `activeTab`：在用户实际调用扩展时定位目标标签页，并支持需要用户调用的标签页级操作。
- `tabCapture`（可选）：仅在用户确认开始并授权后捕获所选标签页音频，以生成实时中文字幕。
- `tts`：按用户操作朗读文字或译文。
- `contextMenus`：提供右键翻译、切换翻译及打开设置等入口。
- `scripting`：显示双语译文、划词面板、悬浮球及字幕；在实时控制页打开时只读检测网页媒体状态，并在选定页面显示授权指引。
- `declarativeNetRequest` 与 `declarativeNetRequestWithHostAccess`：对翻译服务请求应用必要的网络兼容规则，不用于广告追踪。
- `<all_urls>`：使用户能在不同普通网页中使用翻译功能，并在打开实时控制页时寻找可访问的视频/发声标签页。该权限不等同于用户已同意音频捕获。

## 8. 扩展代码与外部服务

扩展界面和主要功能代码随安装包提供。翻译结果、实时会话事件及媒体检测结果按数据处理，不作为扩展更新下载安装。自定义接口、规则及高级配置应仅使用可信来源，且不得用于绕过浏览器权限或用户同意。

## 9. Limited Use 声明

灵犀对 Chrome API 和用户数据的使用遵守 Chrome Web Store User Data Policy 及 Limited Use 要求。数据仅用于提供或改进用户可见、明确披露的翻译功能，不出售，不用于个性化广告，也不用于与单一用途无关的处理。除法律、安全或用户主动请求支持所必需的有限情形外，开发者不人工读取用户翻译内容。

## 10. 安全与用户控制

扩展的远程服务请求要求使用 HTTPS；用户明确配置的本机开发端点可使用本地 HTTP。首次联网处理前会展示数据说明并取得同意，实时音频还需要单独确认及浏览器授权。

用户可以停止实时字幕、关闭控制页、撤回同意、撤销浏览器权限、移除 API 凭据、关闭同步、删除数据或卸载扩展。移除本地 Key 不会在服务商处自动撤销该 Key，需在服务商后台另行撤销或轮换。

## 11. 政策更新

数据处理方式发生变化时，本政策会更新生效日期和适用版本。重大变化会通过适当的产品说明告知用户，并在需要时重新取得同意。隐私政策及商店数据披露应与实际版本的行为保持一致。

## 12. 联系方式

如对本政策有疑问，请通过本仓库的 [GitHub Issues](https://github.com/359073395/hy/issues) 联系维护者。请勿在公开 Issues 中提交 API Key、Cookie、密码、私人通话录音或未脱敏的个人内容；排查时仅提供脱敏信息。

---

# Lingual Insight Privacy Policy — English Summary

**Effective date: November 7, 2026**  
**Applicable version: 2.4.0**

Lingual Insight provides language translation and understanding: webpage, selected-text and input translation, dictionary lookup, subtitle translation and optional real-time Chinese captions.

## Data and local media discovery

The extension processes the text, subtitles and necessary page context requested by the user; page matching information; API and synchronization credentials; preferences, rules, vocabulary and caches. While the real-time control page is open, it locally inspects accessible HTTP(S) tabs for titles, URLs, media element counts and playback, mute or audible status. Candidate lists are kept in control-page memory, not uploaded or persisted. Discovery and target selection do not capture audio, download media or start translation requests. Closing the control page stops its discovery.

## Optional real-time audio captions

Audio processing starts only after the user selects a target, confirms the audio disclosure, clicks Start and obtains browser authorization. Only the selected tab's audio is captured; no microphone, camera or screen video is captured. During an active session, audio is continuously transmitted to the selected real-time translation provider to generate Chinese captions. Original webpage sound is preserved; translated speech is not played.

The extension does not save raw audio files or persist real-time caption history. Stop, closing the control or source page, source navigation/reload, or revocation of consent or capture permission ends the session. Changing the target, page address or service requires renewed audio confirmation. Calls may contain personal communications; obtain any required permission from other participants. Provider charges may apply.

## Recipients and purposes

Translation and dictionary content goes to the provider selected in API settings, which may be an official provider, a self-hosted endpoint or a compatible relay and its upstream processors. Read-aloud text is processed by the browser, system or selected voice service. Providers may also receive connection IP addresses and request metadata. Their retention, processing locations, access and other practices are governed by their own policies.

Credentials are sent to the corresponding endpoint for authentication. Optional configuration sync can also include saved API credentials. There is no separate developer-operated collection endpoint for translation content, audio, real-time captions or candidate lists. The developer does not sell this data or use it for personalized advertising, credit decisions or unrelated profiling.

## Storage, synchronization and deletion

Preferences, credentials, consent records, translation caches, vocabulary and rules are stored locally by default. Local credential storage is not a separate secure vault. When the user enables synchronization, selected data is sent to the configured WebDAV, self-hosted service or GitHub Gist, using the synchronization feature's encryption configuration. Protect the destination and encryption passphrase. Disabling sync does not delete existing remote copies or backups.

Authorization handoff uses browser-memory `storage.session` with only target/controller tab IDs, a service configuration identifier and a timestamp; no API Key, page title, URL or audio consent is stored there. The handoff is valid for five minutes and the record is removed when consumed or checked as expired; session storage also clears when the browser session ends. Temporary real-time credentials and caption text are used only for the current session.

Users can clear available local data, remove credentials, revoke consent or permissions, stop capture, disable sync or uninstall. Remote copies, exports and provider-held data must be managed separately. Removing a local credential does not revoke it at the provider.

## Permissions, code and security

`storage` supports local configuration and temporary handoff; `activeTab` supports user-invoked tab operations; optional `tabCapture` supports explicitly authorized tab audio; `tts` supports read-aloud; `contextMenus` provides user actions; `scripting` displays translation UI and locally inspects media state; declarative network permissions support translation-request compatibility. Broad host access supports translation across websites and user-requested media discovery, not automatic audio consent.

The interface and core extension logic ship in the package. Translation results, real-time events and media status are treated as data, not extension updates. Use trusted sources for advanced configurations. Remote service requests require HTTPS; explicitly configured local development endpoints may use local HTTP. The extension follows Chrome Web Store User Data Policy and Limited Use requirements. It does not independently request health, financial or precise-location information, but content selected by the user may contain sensitive information.

Questions: [GitHub Issues](https://github.com/359073395/hy/issues). Do not post credentials, private recordings or unredacted personal information publicly. This policy will be updated when processing practices change, with renewed consent where needed.
