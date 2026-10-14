# WordPress参考适配

使用当前宿主的WordPress连接器；没有连接器时，仅在用户授权且具备安全认证能力时考虑REST或后台浏览器。不能因网站看起来像WordPress就假定版本、插件或写权限。REST发现及测试用最小只读请求，不能为方便先装插件或改管理员设置。

WordPress原生REST文章/页面/媒体接口是不同资源。通常文章为wp/v2/posts，页面为wp/v2/pages，媒体为wp/v2/media；自定义类型现场发现。读取context=edit可能需权限，公开rendered字段不等于可回写raw。分页保存总页数及实际读取范围，不把默认publish集合当全站。

状态映射保留draft、pending、private、future、publish，不能用布尔published丢信息。发布日期区分站点本地date和UTC date_gmt，定时future须实际站点调度运行后才可能变publish。插件/任务计划是否运行由现场检查，不能从future推断准时执行。

原生文档的普通文章更新没有提供本Skill的通用expectedVersion或requestId契约。某MCP若支持这些字段，只能依现场工具使用；不要给原生REST随意加字段并声称获得原子锁或幂等。无原子保护按authorization处理。

媒体先上传获准文件，记录返回id/source_url，再在获准内容里关联featured_media/实际URL；上传成功不代表文章成功，媒体有公开访问可能。分类/标签是ID数组，SEO插件meta字段必须现场确认其注册和权限，不猜通用meta字段名。

区块编辑器、短代码和主题会影响显示。优先保留已有区块结构；Markdown转HTML需要逐项检查表格/链接/图片/来源，不把模型临时生成HTML当无差异转换。更改slug会影响URL，按用户授权处理。

修订读取支持不代表REST提供完整恢复所有字段的原子动作。核可用修订和实际可恢复字段，必要时取旧文本生成受控update；发布状态、媒体和SEO字段另核。禁止凭“有revision”就承诺一键撤销。

参考官方文档（使用时核当前版本）：[Posts](https://developer.wordpress.org/rest-api/reference/posts/)、[Pages](https://developer.wordpress.org/rest-api/reference/pages/)、[Media](https://developer.wordpress.org/rest-api/reference/media/)、[Authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)、[Revisions](https://developer.wordpress.org/rest-api/reference/post-revisions/)。本Skill不打包WordPress服务端或NotFair连接，不复制上游账号依赖。
