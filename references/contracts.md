# 计划、授权和记录结构

plan与ledger为schema_version=1.1，authorization为1.0。旧计划/结果须实际复核并补齐新字段，不只改版本或哈希。它适用于需要写入的具体计划；简单inspect可交查询结果和读取范围，不强制建空计划。工具只验证已记录字段、关联和状态，不执行远端操作，不验证真实用户指令/工具权限/人审身份。

## plan.json

根：schema_version、id、mode（prepare/execute）、purpose、target、actions。target包含id、origin（仅站点origin，HTTPS）、environment（test/live/unknown）、cms、connection_ref、user_ref、observed_at、capability_evidence和capabilities。标识皆非秘密字符串，observed_at含时区。capabilities中read/create_draft/update/publish/schedule/upload_media/restore/conditional_write均明确布尔；未知用false并在证据限制中说明。

每个action：id、op、resource{kind:post/page/media,id:string或null}、before、patch、readiness、asset、backup、reason。第一版一个计划中每个已有资源最多一个动作；后续发布/关联先读前动作实际结果，再建下一计划。不要用跨动作占位ID。不同资源可以成批准备和逐项执行。

- create_draft：id=null，before=null，patch.status=draft，title和content非空。
- update/restore：资源有ID；before={version:string或null,fields,sha256}。fields保存已读可编辑字段，必须包括当前status；sha256为fields规范化哈希。patch只含要修改的字段，不能改变status或日期；restore需backup={ref,fields,sha256}，每项patch必须与已读备份fields对应值一致，哈希绑定备份字段；其他动作backup=null。不能凭非空来源名称称已核备份。
- publish：patch只有status=publish；schedule：patch只有status=future和publish_at，后者是带明确偏移的日期时间。before必须包含实际title和content，公开或即将公开资源的update/restore也一样；只登记status不够。其他已读要保留的字段按范围保存，不能用展示摘要代替完整正文。页面构建器内容无法映射时停止该工具执行计划，另做适配。
- upload_media：kind=media、id=null、before=null，asset={file_ref,sha256,size,mime,rights_record,privacy_record}，第一版仅支持JPEG/PNG/WebP/GIF/AVIF图片；patch仅title/alt_text。rights_record/privacy_record各为{status:completed/pending,record}，未完成则阻塞上传。file_ref为本地授权文件代号，真实文件读取/上传由宿主处理，工具不读文件；不把临时路径当公开URL。

内容patch字段：title/content/excerpt/slug/categories/tags/featured_media；创建draft还含status。分类标签为实际ID字符串数组；特色图为同站已读媒体ID字符串或null。before必须含所有被更新字段的原值，不能用undefined表示未知。未改字段保留。

readiness用于非媒体动作：{snapshot_sha256,checks}，hash绑定完整预期字段（before.fields与patch合并，创建取patch）。checks有editorial/evidence/medical/channel/privacy，各含{status:completed/pending/not_required,record}。record具体说明范围和审核依据；程序只验证填报。媒体readiness=null，使用asset的权利/隐私记录。

## authorization.json

无授权时用CLI参数`-`，报告阻塞但prepare可正常交付。授权根含schema_version、plan_sha256、user_evidence、recorded_at、action_ids、accept_non_atomic。action_ids列实际获准动作且不重复；accept_non_atomic是其中明确接受非原子更新风险的动作ID子集。哈希来自--fingerprint，真实批准仍要对照可信对话。prepare即使有授权也不执行后台。

blocked记录保留时不能直接放行；核对原因解除后更新记录，unknown则保持先回查规则。execute计划中没有授权或能力不足的动作会列blocked，不能执行该动作。schedule过期、站点环境未知、readiness待办及无并发风险处置同样阻塞。不要为了变成ready自行伪造授权或改审核状态。

## ledger.json

根为schema_version、plan_sha256、entries。每项含action_id、attempt_key、state（not_started/blocked/failed/unknown/verified）、note、executed_at、receipt_ref、readback、public_check。attempt_key绑定同一逻辑动作，重试不换输入；服务是否支持幂等另查。一次记录保存每动作最新状态，原工具回执/尝试历史另存私有引用，不删失败过程。

verified要求executed_at为含偏移的实际执行时间，不早于连接快照；读回时间不早于执行。已确认定时的历史记录按当时执行时间判断，不因今天已经过期而否认登记成功。verified要求真实回执引用及readback={site_id,resource_id,observed_at,evidence_ref,fields,fields_sha256}，站点/已有ID一致，fields规范化hash正确，所有计划预期字段与读回一致。媒体预期为patch（title/alt），文件身份仍须实际回执核对，不凭这两个字段确认文件完全相同。新增资源ID为读回实际ID；不能填null。此校验无法证明回执没被编造。

public_check可null；非空含url、observed_at、evidence_ref、status（visible/unconfirmed），visible另需resource_id、expected_sha256关联实际读回ID和本次预期字段hash，检查时间不早于后台读回；不是后台状态字段的替代。工具只允许publish或已公开资源更新/恢复登记visible；不会从它计算AI收录、医疗正确或公众权限认证。已登记future不得标visible，需到期重读后形成真实新记录。query结果与公开可见性限制在note/报告中说明。

计划变化不能复用旧ledger；verified也不能在缺授权、能力或必要检查时声称已合法执行。unknown不允许工具建议重试，报告固定要求先回查。脚本报告是记录一致性检查，不是远端执行日志自动采集器。

## 交付

具体站点/模式、逐动作当前状态与阻塞、改了哪些字段、回执/读回证据、公开检查、未决事项、恢复条件。public_check关联字段仍只是记录，程序不读取页面或认证用户真正看到的内容。脚本输出operations-results.json和report.html到新目录，不覆盖输入或既有结果。哈希按递归对象键排序、数组顺序保留、UTF8 SHA256，使用脚本获取，不手算或归一文本后冒充原文。
