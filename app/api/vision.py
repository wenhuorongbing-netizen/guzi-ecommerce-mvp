import base64
import json
import os
from fastapi import APIRouter, HTTPException, Form, UploadFile, File
import httpx
import logging
from typing import Optional

router = APIRouter()
logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "your-api-key")
# Or a local/compatible endpoint for the VLM
VISION_API_URL = os.getenv("VISION_API_URL", "https://api.openai.com/v1/chat/completions")

def encode_image(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")

@router.post("/auto-tag")
async def auto_tag_merch(
    file: UploadFile = File(...),
    reference_text: str = Form(...)
):
    """
    Ground-Truth Anchored AI Tagging Endpoint (The Lightning Tagger)
    Receives an image and a reference text (like a receipt or purchase list).
    Instructs the Vision LLM to ONLY identify items that appear in the reference text.
    Returns bounding box coordinates and matched item details.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024: # 10MB limit
        raise HTTPException(status_code=400, detail="Image size exceeds 10MB limit")

    base64_image = encode_image(image_bytes)

    # --- Prompt Engineering for Ground-Truth Anchored AI Tagging ---
    system_prompt = (
        "你是一个极其严谨的商品打点助手（Lightning Tagger）。"
        "你的任务是在用户提供的图片中寻找商品，并返回它们的中心点坐标。"
        "【极其重要的约束条件】：你绝对不能自己凭空捏造商品名称！你只能从用户提供的【参考购物清单文本】中提取实际存在的商品名称进行匹配匹配。如果图片里有个东西不在清单上，请直接忽略它。"
        "你必须以严格的 JSON 数组格式返回结果，不能包含任何多余的 Markdown 格式或文字解释。如果找不到任何匹配项，返回空数组 []。"
        "返回的 JSON 数组的每个对象必须严格包含以下字段：\n"
        "1. 'name' (字符串：必须完全等同于清单中提取出的商品名称)\n"
        "2. 'price' (数字：如果清单中有价格就提取，没有则默认为 0)\n"
        "3. 'x' (数字：代表物品中心点相对于图片宽度的百分比，0-100)\n"
        "4. 'y' (数字：代表物品中心点相对于图片高度的百分比，0-100)\n"
    )

    user_prompt = (
        f"【参考购物清单文本】：\n{reference_text}\n\n"
        "请仔细阅读上面的清单，然后观察下面这张图片。帮我把清单里的商品在图片上标出来，并输出我要求的 JSON 格式。"
    )

    payload = {
        "model": "gpt-4o", # Model capable of strong alignment and vision processing
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{file.content_type};base64,{base64_image}"
                        }
                    }
                ]
            }
        ],
        "max_tokens": 1500,
        "temperature": 0.0 # Strict zero temperature to avoid hallucination and enforce alignment
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(VISION_API_URL, headers=headers, json=payload)
            response.raise_for_status()

            result_data = response.json()
            content = result_data["choices"][0]["message"]["content"]

            # Defensive parsing of JSON (stripping markdown backticks if the model ignored instructions)
            clean_content = content.strip()
            if clean_content.startswith("```json"):
                clean_content = clean_content[7:]
            if clean_content.endswith("```"):
                clean_content = clean_content[:-3]

            items = json.loads(clean_content.strip())

            # Additional validation to ensure required fields exist
            validated_items = []
            for item in items:
                if "x" in item and "y" in item and "name" in item:
                    validated_items.append({
                        "name": item["name"],
                        "price": item.get("price", 0),
                        "x": float(item["x"]),
                        "y": float(item["y"]),
                        "stock": 1 # Default stock for tagged items
                    })

            return {
                "status": "success",
                "items": validated_items
            }

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI response as JSON: {content}")
        raise HTTPException(status_code=500, detail="AI returned invalid data format. Please try again.")
    except httpx.HTTPError as e:
        logger.error(f"Vision API request failed: {e}")
        raise HTTPException(status_code=502, detail="Failed to communicate with Vision AI service.")
    except Exception as e:
        logger.error(f"Unexpected error in auto-tagging: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred during auto-tagging.")