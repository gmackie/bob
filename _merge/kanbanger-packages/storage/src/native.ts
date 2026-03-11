import * as ImagePicker from "expo-image-picker";
import { File, Paths, downloadAsync, deleteAsync } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";

export interface PickImageOptions {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
  allowsMultipleSelection?: boolean;
}

export interface ImagePickerResult {
  success: boolean;
  uri?: string;
  uris?: string[];
  width?: number;
  height?: number;
  type?: string;
  error?: string;
}

export async function pickImage(
  options: PickImageOptions = {}
): Promise<ImagePickerResult> {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return { success: false, error: "Permission to access media library was denied" };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: options.allowsEditing ?? false,
      aspect: options.aspect,
      quality: options.quality ?? 0.8,
      allowsMultipleSelection: options.allowsMultipleSelection ?? false,
    });

    if (result.canceled) {
      return { success: false, error: "User cancelled image picker" };
    }

    const asset = result.assets[0];
    if (!asset) {
      return { success: false, error: "No image selected" };
    }

    return {
      success: true,
      uri: asset.uri,
      uris: result.assets.map((a) => a.uri),
      width: asset.width,
      height: asset.height,
      type: asset.type ?? undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to pick image";
    return { success: false, error: message };
  }
}

export async function takePhoto(
  options: Omit<PickImageOptions, "allowsMultipleSelection"> = {}
): Promise<ImagePickerResult> {
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      return { success: false, error: "Permission to access camera was denied" };
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: options.allowsEditing ?? false,
      aspect: options.aspect,
      quality: options.quality ?? 0.8,
    });

    if (result.canceled) {
      return { success: false, error: "User cancelled camera" };
    }

    const asset = result.assets[0];
    if (!asset) {
      return { success: false, error: "No photo taken" };
    }

    return {
      success: true,
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      type: asset.type ?? undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to take photo";
    return { success: false, error: message };
  }
}

export interface ShareOptions {
  mimeType?: string;
  dialogTitle?: string;
  UTI?: string;
}

export interface ShareResult {
  success: boolean;
  error?: string;
}

export async function shareFile(
  uri: string,
  options: ShareOptions = {}
): Promise<ShareResult> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, error: "Sharing is not available on this device" };
    }

    await Sharing.shareAsync(uri, {
      mimeType: options.mimeType,
      dialogTitle: options.dialogTitle,
      UTI: options.UTI,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to share file";
    return { success: false, error: message };
  }
}

export interface PrintToPdfOptions {
  html: string;
  width?: number;
  height?: number;
  base64?: boolean;
}

export interface PrintToPdfResult {
  success: boolean;
  uri?: string;
  base64?: string;
  error?: string;
}

export async function printToPdf(
  options: PrintToPdfOptions
): Promise<PrintToPdfResult> {
  try {
    const result = await Print.printToFileAsync({
      html: options.html,
      width: options.width,
      height: options.height,
      base64: options.base64,
    });

    return {
      success: true,
      uri: result.uri,
      base64: result.base64,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate PDF";
    return { success: false, error: message };
  }
}

export async function printHtml(html: string): Promise<void> {
  await Print.printAsync({ html });
}

export async function downloadFile(
  url: string,
  filename: string
): Promise<{ success: boolean; uri?: string; error?: string }> {
  try {
    const directory = Paths.cache.uri;
    if (!directory) {
      return { success: false, error: "Cache directory not available" };
    }

    const fileUri = `${directory}${filename}`;
    const downloadResult = await downloadAsync(url, fileUri);

    if (downloadResult.status !== 200) {
      return { success: false, error: `Download failed with status ${downloadResult.status}` };
    }

    return { success: true, uri: downloadResult.uri };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download file";
    return { success: false, error: message };
  }
}

export async function readFileAsBase64(uri: string): Promise<string | null> {
  try {
    const file = new File(uri);
    return await file.base64();
  } catch {
    return null;
  }
}

export async function deleteFile(uri: string): Promise<boolean> {
  try {
    await deleteAsync(uri, { idempotent: true });
    return true;
  } catch {
    return false;
  }
}
