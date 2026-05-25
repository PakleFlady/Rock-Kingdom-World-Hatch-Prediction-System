# Rock Kingdom World Hatch Prediction System

这是一个本地运行的机器学习小应用。你可以逐条录入数据：

```text
尺寸 重量 精灵
```

系统会自动去重，同一组“尺寸 + 重量 + 精灵”不会重复计入。每次新增有效数据后，后端会重新训练模型。预测时输入尺寸和重量，只展示概率大于 1% 的精灵结果。

单条录入时，先输入尺寸和重量，系统会在录入区自动显示候选精灵。点击候选精灵会直接把“尺寸 + 重量 + 该精灵”加入数据集；如果候选里没有正确结果，就在精灵输入框手动填入正确答案后添加。

界面分为两个页面：

- `预测`：只用于输入尺寸、重量并查看预测概率。
- `添加数据`：包含单条录入、批量录入和数据集管理。

## 快速启动

需要 Python 3.10 或更高版本。

```powershell
python app.py
```

在 Windows PowerShell 里也可以直接运行：

```powershell
.\run.ps1
```

启动后打开：

```text
http://127.0.0.1:8000
```

如果 8000 端口被占用，可以指定端口：

```powershell
python app.py --port 8010
```

## 数据文件

数据会保存到：

```text
data/dataset.json
```

模型训练摘要会保存到：

```text
data/model.json
```

这两个文件会在第一次运行或第一次录入数据时自动创建。

## 当前机器学习方法

当前模型是“标准化加权 kNN 分类器”：

1. 读取所有已录入样本。
2. 分别计算尺寸和重量的均值、标准差，用于标准化。
3. 预测时计算输入点到每个样本的二维距离。
4. 取最近的若干个样本，距离越近权重越高。
5. 按精灵聚合权重，得到每个精灵的概率。
6. 只返回概率大于 1% 的结果。

这个方法很适合早期手动积累数据的场景，因为样本量小也能输出结果，而且新增数据后几乎可以立刻重训。

## 后续开发建议

核心代码在 `hatch_predictor/`：

- `storage.py`：负责数据集读写和三元组去重。
- `model.py`：负责训练、保存模型摘要和预测。
- `server.py`：负责 HTTP API 和静态页面。

如果以后数据量变大，可以把 `model.py` 替换为 scikit-learn 模型，例如：

- `KNeighborsClassifier`
- `RandomForestClassifier`
- `GradientBoostingClassifier`

建议保留当前 API 输出格式，这样前端不需要改：

```json
{
  "results": [
    {
      "creature": "精灵名",
      "probability": 0.56,
      "percent": "56.00%"
    }
  ]
}
```

## API

### 新增样本

`POST /api/samples`

```json
{
  "size": 12.3,
  "weight": 4.5,
  "creature": "火花"
}
```

返回：

```json
{
  "added": true,
  "message": "已添加并重新训练模型",
  "stats": {
    "sample_count": 1,
    "class_count": 1
  }
}
```

如果重复录入完全相同的三元组，`added` 会是 `false`。

### 批量新增样本

`POST /api/samples/bulk`

支持每行一条：

```text
12.3 4.5 火花
12.4,4.4,火花
13.1	5.1	水蓝蓝
```

### 预测

`POST /api/predict`

```json
{
  "size": 12.2,
  "weight": 4.6
}
```

### 查看数据集

`GET /api/samples`

### 删除样本

`DELETE /api/samples?id=样本ID`

删除后会自动重新训练模型。

## 注意

这个项目不自带洛克王国世界的真实孵蛋数据。预测质量完全取决于你录入的数据量和数据准确度。前期数据少时，结果只能当参考；同一精灵建议录入多组尺寸重量样本。
