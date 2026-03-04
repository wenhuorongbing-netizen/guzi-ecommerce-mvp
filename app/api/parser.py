import os
import json
import logging
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "your-api-key")
LLM_API_URL = os.getenv("LLM_API_URL", "https://api.openai.com/v1/chat/completions")

class ExtractTextRequest(BaseModel):
    reference_text: str

@router.post("/extract-items")
async def extract_items(req: ExtractTextRequest):
    """
    Text-to-Chips Architecture: Backend Parser
    Takes messy raw text (like a Taobao or Xianyu receipt) and uses a fast,
    lightweight text-only LLM to extract a structured list of items, quantities, and prices.
    """

    if not req.reference_text.strip():
        raise HTTPException(status_code=400, detail="Reference text cannot be empty.")

    system_prompt = (
        "你是一个极其精准的电商订单解析助手。"
        "你的任务是从用户粘贴的杂乱订单文本（如淘宝/煤炉购买记录）中，提取出所有购买的商品条目。"
        "【严格要求】：你必须返回一个纯 JSON 数组，不带任何 Markdown 标记或多余的文字说明。"
        "如果文本中某件商品购买了多个（例如“数量：2”或“x2”），你需要将它拆分成多个独立的对象（即每一行代表一个独立实体，数量强转为 1）。"
        "每个对象必须包含：\n"
        "1. 'name' (字符串：商品的名称，可适当简化去除无关前缀)\n"
        "2. 'price' (数字：单价，如果没有提取到则默认为 0)\n"
        "3. 'qty' (数字：永远固定为 1，因为如果有多个，你需要输出多行 JSON)\n"
    )

    user_prompt = f"【订单文本】：\n{req.reference_text}\n\n请提取并输出纯 JSON 数组："

    payload = {
        "model": "llama3-8b", # Use a fast, cheap model for text processing
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.0 # Force deterministic parsing
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(LLM_API_URL, headers=headers, json=payload)
            response.raise_for_status()

            result_data = response.json()
            content = result_data["choices"][0]["message"]["content"]

            # Defensive JSON cleaning
            clean_content = content.strip()
            if clean_content.startswith("```json"):
                clean_content = clean_content[7:]
            if clean_content.endswith("```"):
                clean_content = clean_content[:-3]

            items = json.loads(clean_content.strip())

            # Basic structural validation
            validated_items = []
            for item in items:
                if "name" in item:
                    validated_items.append({
                        "name": item["name"],
                        "price": float(item.get("price", 0)),
                        "qty": 1
                    })

            return {
                "status": "success",
                "items": validated_items
            }

    except json.JSONDecodeError:
        logger.error(f"LLM failed to output valid JSON: {content}")
        raise HTTPException(status_code=500, detail="Failed to parse AI output into JSON.")
    except httpx.HTTPError as e:
        logger.error(f"LLM API request failed: {e}")
        raise HTTPException(status_code=502, detail="Upstream AI service is currently unavailable.")
    except Exception as e:
        logger.error(f"Unexpected error in parsing: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred during text extraction.")