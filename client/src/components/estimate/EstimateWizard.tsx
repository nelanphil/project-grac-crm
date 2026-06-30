"use client";

import { useState } from "react";
import { submitLead } from "@/lib/api";
import {
  INITIAL_ESTIMATE_FORM,
  type EstimateFormData,
  type EstimatePayload,
} from "@/lib/estimate-types";
import EstimateLayout from "./EstimateLayout";
import EstimateSuccess from "./EstimateSuccess";
import ContactStep from "./steps/ContactStep";
import LocationStep from "./steps/LocationStep";
import HomeFinancingStep from "./steps/HomeFinancingStep";

const TOTAL_STEPS = 3;

function validateStep1(data: EstimateFormData): Partial<Record<keyof EstimateFormData, string>> {
  const errors: Partial<Record<keyof EstimateFormData, string>> = {};
  if (!data.firstName.trim()) errors.firstName = "First name is required";
  if (!data.lastName.trim()) errors.lastName = "Last name is required";
  if (!data.email.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = "Please enter a valid email";
  }
  return errors;
}

function validateStep2(data: EstimateFormData): Partial<Record<keyof EstimateFormData, string>> {
  const errors: Partial<Record<keyof EstimateFormData, string>> = {};
  if (!data.addressLine1.trim()) errors.addressLine1 = "Address is required";
  if (!data.city.trim()) errors.city = "City is required";
  if (!data.state) errors.state = "State is required";
  if (!data.zipCode.trim()) errors.zipCode = "Zip code is required";
  if (!data.phone.trim()) errors.phone = "Phone number is required";
  return errors;
}

function validateStep3(data: EstimateFormData): Partial<Record<keyof EstimateFormData, string>> {
  const errors: Partial<Record<keyof EstimateFormData, string>> = {};
  if (!data.homeType) errors.homeType = "Please select a home type";
  if (data.interestedInFinancing === null) {
    errors.interestedInFinancing = "Please select a financing option";
  }
  return errors;
}

export default function EstimateWizard() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<EstimateFormData>(INITIAL_ESTIMATE_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof EstimateFormData, string>>>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const updateField = (
    field: keyof EstimateFormData,
    value: string | boolean | null
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleNext = async () => {
    setSubmitError("");

    if (step === 1) {
      const stepErrors = validateStep1(formData);
      if (Object.keys(stepErrors).length > 0) {
        setErrors(stepErrors);
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      const stepErrors = validateStep2(formData);
      if (Object.keys(stepErrors).length > 0) {
        setErrors(stepErrors);
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      const stepErrors = validateStep3(formData);
      if (Object.keys(stepErrors).length > 0) {
        setErrors(stepErrors);
        return;
      }

      setIsSubmitting(true);
      try {
        const payload: EstimatePayload = {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim(),
          country: formData.country,
          addressLine1: formData.addressLine1.trim(),
          addressLine2: formData.addressLine2.trim() || undefined,
          city: formData.city.trim(),
          state: formData.state,
          zipCode: formData.zipCode.trim(),
          phone: formData.phone.trim(),
          smsConsent: formData.smsConsent,
          homeType: formData.homeType as "single_family" | "other",
          interestedInFinancing: formData.interestedInFinancing as boolean,
          marketingConsent: true,
          source: "estimate-form",
        };

        await submitLead(payload);
        setSubmitted(true);
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : "Failed to submit. Please try again."
        );
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handlePrevious = () => {
    if (step > 1) {
      setErrors({});
      setSubmitError("");
      setStep(step - 1);
    }
  };

  if (submitted) {
    return <EstimateSuccess />;
  }

  return (
    <EstimateLayout
      step={step}
      totalSteps={TOTAL_STEPS}
      onPrevious={handlePrevious}
      onNext={handleNext}
      nextLabel={step === TOTAL_STEPS ? "Submit" : "Next step"}
      nextDisabled={isSubmitting}
    >
      {step === 1 && (
        <ContactStep data={formData} errors={errors} onChange={updateField} />
      )}
      {step === 2 && (
        <LocationStep data={formData} errors={errors} onChange={updateField} />
      )}
      {step === 3 && (
        <HomeFinancingStep
          data={formData}
          errors={errors}
          onChange={updateField}
          submitError={submitError}
          isSubmitting={isSubmitting}
        />
      )}
    </EstimateLayout>
  );
}
